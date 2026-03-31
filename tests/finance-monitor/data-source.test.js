/**
 * Tests for finance-monitor/lib/data-source.js parse helpers.
 *
 * These tests exercise pure parsing functions without making any HTTP requests.
 * The plugin lives at ~/.hanako-dev/plugins/finance-monitor/ (outside the repo),
 * so we import it via an absolute path resolved from the HOME directory.
 */

import { describe, it, expect } from 'vitest';
import os from 'os';
import path from 'path';

// Resolve plugin path at import time to keep tests portable across machines.
// HANA_HOME is respected if set; otherwise fall back to ~/.hanako-dev for dev.
const hanaHome = process.env.HANA_HOME ?? path.join(os.homedir(), '.hanako-dev');
const dataSourcePath = path.join(hanaHome, 'plugins', 'finance-monitor', 'lib', 'data-source.js');

const {
  parseTencentQuoteLine,
  parseTencentBatchQuote,
  parseTencentKline,
  mapPeriodToTencent,
  parseSinaQuoteLine,
  parseEastmoneyNewsJsonp,
} = await import(dataSourcePath);

// ---------------------------------------------------------------------------
// parseTencentQuoteLine
// ---------------------------------------------------------------------------

describe('parseTencentQuoteLine', () => {
  // Real-format mock: fields [1]=name [2]=code [3]=price [4]=prevClose [5]=open
  // [6]=volume [30]=high [31]=low [32]=change [33]=changePct [37]=turnover [30]=time
  // We build a synthetic line with 40 tilde-separated fields.
  function makeLine(symbol, fields = {}) {
    // Build a 40-element array pre-filled with "0"
    const parts = new Array(40).fill('0');
    parts[0] = '1';                           // market flag
    parts[1] = fields.name ?? '贵州茅台';
    parts[2] = fields.code ?? '600519';
    parts[3] = fields.price ?? '1800.00';
    parts[4] = fields.prevClose ?? '1790.00';
    parts[5] = fields.open ?? '1795.00';
    parts[6] = fields.volume ?? '50000';
    parts[30] = fields.time ?? '14:30:00';
    parts[31] = fields.change ?? '10.00';
    parts[32] = fields.changePct ?? '0.56';
    parts[33] = fields.high ?? '1820.00';
    parts[34] = fields.low ?? '1780.00';
    parts[37] = fields.turnover ?? '900000000';
    return `v_${symbol}="${parts.join('~')}"`;
  }

  it('parses a well-formed Tencent quote line', () => {
    const line = makeLine('sh600519');
    const result = parseTencentQuoteLine(line);

    expect(result).not.toBeNull();
    expect(result.symbol).toBe('sh600519');
    expect(result.name).toBe('贵州茅台');
    expect(result.code).toBe('600519');
    expect(result.price).toBe(1800.0);
    expect(result.prevClose).toBe(1790.0);
    expect(result.open).toBe(1795.0);
    expect(result.volume).toBe(50000);
    expect(result.high).toBe(1820.0);
    expect(result.low).toBe(1780.0);
    expect(result.change).toBe(10.0);
    expect(result.changePct).toBe(0.56);
    expect(result.turnover).toBe(900000000);
    expect(result.time).toBe('14:30:00');
  });

  it('returns null for an empty quoted value', () => {
    expect(parseTencentQuoteLine('v_sh600519=""')).toBeNull();
  });

  it('returns null for a line with no recognisable pattern', () => {
    expect(parseTencentQuoteLine('some random garbage')).toBeNull();
  });

  it('returns null when there are too few tilde-separated fields', () => {
    expect(parseTencentQuoteLine('v_sh600519="1~name~code"')).toBeNull();
  });

  it('handles an index fund symbol (sh000001)', () => {
    const line = makeLine('sh000001', { name: '上证指数', code: '000001', price: '3300.00' });
    const result = parseTencentQuoteLine(line);
    expect(result).not.toBeNull();
    expect(result.symbol).toBe('sh000001');
    expect(result.price).toBe(3300.0);
  });
});

// ---------------------------------------------------------------------------
// parseTencentBatchQuote
// ---------------------------------------------------------------------------

describe('parseTencentBatchQuote', () => {
  function makeFullLine(symbol, price) {
    const parts = new Array(40).fill('0');
    parts[0] = '1';
    parts[1] = `Stock${symbol}`;
    parts[2] = symbol.slice(2);
    parts[3] = String(price);
    parts[4] = String(price - 10);
    parts[5] = String(price - 5);
    parts[6] = '10000';
    parts[30] = '10:00:00';
    parts[31] = '10.00';
    parts[32] = '0.50';
    parts[33] = String(price + 20);
    parts[34] = String(price - 20);
    parts[37] = '500000000';
    return `v_${symbol}="${parts.join('~')}"`;
  }

  it('returns a Map keyed by symbol', () => {
    const text = [
      makeFullLine('sh600519', 1800),
      makeFullLine('sz000001', 12),
    ].join('\n');

    const result = parseTencentBatchQuote(text);
    expect(result.size).toBe(2);
    expect(result.has('sh600519')).toBe(true);
    expect(result.has('sz000001')).toBe(true);
    expect(result.get('sh600519').price).toBe(1800);
    expect(result.get('sz000001').price).toBe(12);
  });

  it('skips blank lines silently', () => {
    const text = '\n\n' + makeFullLine('sh600519', 1800) + '\n\n';
    const result = parseTencentBatchQuote(text);
    expect(result.size).toBe(1);
  });

  it('returns an empty Map for an empty string', () => {
    expect(parseTencentBatchQuote('').size).toBe(0);
  });

  it('skips malformed lines without throwing', () => {
    const text = 'garbage\n' + makeFullLine('sh600519', 1800);
    const result = parseTencentBatchQuote(text);
    expect(result.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// mapPeriodToTencent
// ---------------------------------------------------------------------------

describe('mapPeriodToTencent', () => {
  it('maps standard period names correctly', () => {
    expect(mapPeriodToTencent('daily')).toBe('day');
    expect(mapPeriodToTencent('weekly')).toBe('week');
    expect(mapPeriodToTencent('monthly')).toBe('month');
    expect(mapPeriodToTencent('5m')).toBe('m5');
    expect(mapPeriodToTencent('60m')).toBe('m60');
  });

  it('falls back to "day" for unknown periods', () => {
    expect(mapPeriodToTencent('unknown')).toBe('day');
  });
});

// ---------------------------------------------------------------------------
// parseTencentKline
// ---------------------------------------------------------------------------

describe('parseTencentKline', () => {
  // Tencent kline candle format: [date, open, close, high, low, volume]
  const mockKlineJson = {
    data: {
      sh600519: {
        day: [
          ['2024-01-02', '1780.00', '1800.00', '1820.00', '1760.00', '50000'],
          ['2024-01-03', '1800.00', '1790.00', '1810.00', '1775.00', '45000'],
        ],
      },
    },
  };

  it('parses kline data correctly', () => {
    const result = parseTencentKline(mockKlineJson, 'sh600519', 'daily');

    expect(result).not.toBeNull();
    expect(result.symbol).toBe('sh600519');
    expect(result.period).toBe('daily');
    expect(result.data).toHaveLength(2);

    const first = result.data[0];
    expect(first.time).toBe('2024-01-02');
    expect(first.open).toBe(1780.0);
    expect(first.close).toBe(1800.0);
    expect(first.high).toBe(1820.0);
    expect(first.low).toBe(1760.0);
    expect(first.volume).toBe(50000);
  });

  it('returns null when the symbol is not in the response', () => {
    const result = parseTencentKline(mockKlineJson, 'sz000001', 'daily');
    expect(result).toBeNull();
  });

  it('returns null for null/undefined JSON', () => {
    expect(parseTencentKline(null, 'sh600519', 'daily')).toBeNull();
    expect(parseTencentKline(undefined, 'sh600519', 'daily')).toBeNull();
  });

  it('returns empty data array when period data is missing', () => {
    const json = { data: { sh600519: {} } };
    const result = parseTencentKline(json, 'sh600519', 'daily');
    expect(result).not.toBeNull();
    expect(result.data).toHaveLength(0);
  });

  it('handles weekly and monthly periods', () => {
    const json = {
      data: {
        sh600519: {
          week: [['2024-01-05', '1780.00', '1810.00', '1830.00', '1760.00', '250000']],
        },
      },
    };
    const result = parseTencentKline(json, 'sh600519', 'weekly');
    expect(result).not.toBeNull();
    expect(result.data).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// parseSinaQuoteLine
// ---------------------------------------------------------------------------

describe('parseSinaQuoteLine', () => {
  /**
   * Build a synthetic Sina quote line.
   * Sina format: var hq_str_<symbol>="<comma-separated fields>";
   * We need at least 32 fields. The bid/ask ladder occupies fields 10-29.
   */
  function makeSinaLine(symbol, overrides = {}) {
    const fields = new Array(32).fill('0.00');
    fields[0] = overrides.name ?? '贵州茅台';
    fields[1] = overrides.open ?? '1795.00';
    fields[2] = overrides.prevClose ?? '1790.00';
    fields[3] = overrides.price ?? '1800.00';
    fields[4] = overrides.high ?? '1820.00';
    fields[5] = overrides.low ?? '1780.00';
    fields[6] = '0.00'; // bid
    fields[7] = '0.00'; // ask
    fields[8] = overrides.volume ?? '5000000';
    fields[9] = overrides.turnover ?? '900000000';
    // bid ladder [10..19]: bid5price, bid5vol, bid4price, bid4vol, ...
    for (let i = 0; i < 5; i++) {
      fields[10 + i * 2] = String(1799 - i);
      fields[11 + i * 2] = String(100 * (i + 1));
    }
    // ask ladder [20..29]
    for (let i = 0; i < 5; i++) {
      fields[20 + i * 2] = String(1801 + i);
      fields[21 + i * 2] = String(100 * (i + 1));
    }
    fields[30] = overrides.date ?? '2024-01-02';
    fields[31] = overrides.time ?? '14:30:00';
    return `var hq_str_${symbol}="${fields.join(',')}";`;
  }

  it('parses a well-formed Sina quote line', () => {
    const line = makeSinaLine('sh600519');
    const result = parseSinaQuoteLine(line);

    expect(result).not.toBeNull();
    expect(result.symbol).toBe('sh600519');
    expect(result.name).toBe('贵州茅台');
    expect(result.price).toBe(1800.0);
    expect(result.prevClose).toBe(1790.0);
    expect(result.high).toBe(1820.0);
    expect(result.low).toBe(1780.0);
  });

  it('includes five-level bid/ask ladder', () => {
    const line = makeSinaLine('sh600519');
    const result = parseSinaQuoteLine(line);

    expect(result.bids).toHaveLength(5);
    expect(result.asks).toHaveLength(5);
    expect(result.bids[0].price).toBe(1799);
    expect(result.asks[0].price).toBe(1801);
  });

  it('computes change and changePct from price and prevClose', () => {
    const line = makeSinaLine('sh600519', { price: '1800.00', prevClose: '1790.00' });
    const result = parseSinaQuoteLine(line);

    expect(result.change).toBeCloseTo(10.0, 2);
    expect(result.changePct).toBeCloseTo((10 / 1790) * 100, 2);
  });

  it('returns null for an empty quoted value', () => {
    expect(parseSinaQuoteLine('var hq_str_sh600519="";')).toBeNull();
  });

  it('returns null for lines with too few fields', () => {
    expect(parseSinaQuoteLine('var hq_str_sh600519="only,three,fields";')).toBeNull();
  });

  it('returns null for unrecognised line format', () => {
    expect(parseSinaQuoteLine('garbage input')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseEastmoneyNewsJsonp
// ---------------------------------------------------------------------------

describe('parseEastmoneyNewsJsonp', () => {
  const mockJsonp = `jQuery({
    "data": {
      "result": [
        {
          "Title": "贵州茅台三季报净利润同比增长15%",
          "Url": "https://finance.eastmoney.com/a/12345.html",
          "MediaName": "东方财富网",
          "ShowTime": "2024-10-29 08:30:00",
          "Digest": "贵州茅台发布三季报..."
        },
        {
          "Title": "机构大幅增持茅台",
          "Url": "https://finance.eastmoney.com/a/67890.html",
          "MediaName": "财联社",
          "ShowTime": "2024-10-28 16:00:00",
          "Digest": ""
        }
      ]
    }
  })`;

  it('parses well-formed JSONP news response', () => {
    const result = parseEastmoneyNewsJsonp(mockJsonp);

    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('贵州茅台三季报净利润同比增长15%');
    expect(result[0].url).toBe('https://finance.eastmoney.com/a/12345.html');
    expect(result[0].source).toBe('东方财富网');
    expect(result[0].time).toBe('2024-10-29 08:30:00');
    expect(result[0].summary).toBe('贵州茅台发布三季报...');
  });

  it('returns empty array for malformed JSONP', () => {
    expect(parseEastmoneyNewsJsonp('not jsonp at all')).toEqual([]);
    expect(parseEastmoneyNewsJsonp('')).toEqual([]);
    expect(parseEastmoneyNewsJsonp('jQuery(invalid json)')).toEqual([]);
  });

  it('returns empty array when result list is missing', () => {
    const emptyJsonp = 'jQuery({"data": {}})';
    expect(parseEastmoneyNewsJsonp(emptyJsonp)).toEqual([]);
  });

  it('handles alternative JSONP callback names', () => {
    const text = `jQuery123456({"data":{"result":[{"Title":"Test","Url":"http://x.com","MediaName":"src","ShowTime":"2024-01-01","Digest":""}]}})`;
    const result = parseEastmoneyNewsJsonp(text);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Test');
  });
});
