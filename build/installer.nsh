; installer.nsh — NSIS custom hooks for Hanako installer
;
; Kills running Hanako processes before install/uninstall to prevent
; "file in use" errors on Windows overlay installs.

; Disable CRC integrity check — electron-builder's post-compilation PE editing
; (signtool + rcedit) corrupts the NSIS CRC when no signing cert is configured,
; causing "Installer integrity check has failed" on Windows.
CRCCheck off

!include LogicLib.nsh

!macro hanakoFindProcess _NAME _RETURN
  nsExec::ExecToLog `"$CmdPath" /C tasklist /FI "IMAGENAME eq ${_NAME}" /FO CSV | "$FindPath" "${_NAME}"`
  Pop ${_RETURN}
!macroend

!macro hanakoFindRunningProcesses _RETURN
  !insertmacro hanakoFindProcess Hanako.exe ${_RETURN}
  ${If} ${_RETURN} != 0
    !insertmacro hanakoFindProcess hana-server.exe ${_RETURN}
  ${EndIf}
!macroend

!macro hanakoKillProcess _NAME _FORCE
  Push $0
  Push $1
  ${If} ${_FORCE} == 1
    StrCpy $0 "/F"
  ${Else}
    StrCpy $0 ""
  ${EndIf}
  nsExec::ExecToLog `"$CmdPath" /C taskkill $0 /IM "${_NAME}"`
  Pop $1
  Pop $1
  Pop $0
!macroend

!macro hanakoKillRunningProcesses _FORCE
  !insertmacro hanakoKillProcess Hanako.exe ${_FORCE}
  !insertmacro hanakoKillProcess hana-server.exe ${_FORCE}
!macroend

!macro customCheckAppRunning
  !insertmacro hanakoFindRunningProcesses $R0
  ${If} $R0 == 0
    DetailPrint "Detected Hanako.exe or hana-server.exe; closing them before install."
    !insertmacro hanakoKillRunningProcesses 0
    Sleep 500

    !insertmacro hanakoFindRunningProcesses $R0
    ${If} $R0 == 0
      !insertmacro hanakoKillRunningProcesses 1
      Sleep 1000
    ${EndIf}

    StrCpy $R1 0
    hanako_check_processes:
      !insertmacro hanakoFindRunningProcesses $R0
      ${If} $R0 == 0
        IntOp $R1 $R1 + 1
        DetailPrint "Waiting for Hanako.exe or hana-server.exe to close."
        ${If} $R1 > 2
          DetailPrint "Hanako.exe or hana-server.exe still running; asking user to retry."
          MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY hanako_retry_close
          Quit
          hanako_retry_close:
          StrCpy $R1 0
        ${EndIf}
        !insertmacro hanakoKillRunningProcesses 1
        Sleep 1000
        Goto hanako_check_processes
      ${EndIf}
  ${EndIf}
!macroend

!macro hanakoCleanBundledServer
  ; resources\server is generated on every build. Remove it before copying
  ; new files so a failed stale uninstall cannot leave mixed bundle/deps/native files.
  IfFileExists "$INSTDIR\resources\server\*.*" 0 +3
    DetailPrint "Removing old bundled server resources"
    RMDir /r "$INSTDIR\resources\server"
!macroend

!macro customInit
  ; Kill Electron main process
  nsExec::ExecToLog 'taskkill /F /IM "Hanako.exe"'
  ; Kill bundled server process (renamed node.exe)
  nsExec::ExecToLog 'taskkill /F /IM "hana-server.exe"'
  ; Wait for file handles to release
  Sleep 2000
!macroend

!macro customUnInstallCheck
  ; Preserve electron-builder's default handling: a missing stale uninstaller
  ; can fall through to a clean overlay, but a real non-zero uninstaller exit
  ; must stop the install instead of silently mixing old and new files.
  ${If} ${Errors}
    DetailPrint `Uninstall was not successful. Not able to launch uninstaller; continuing with clean overlay.`
    ClearErrors
  ${ElseIf} $R0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(uninstallFailed): $R0"
    DetailPrint `Uninstall was not successful. Uninstaller error code: $R0.`
    SetErrorLevel 2
    Quit
  ${EndIf}
  !insertmacro hanakoCleanBundledServer
!macroend

!macro customUnInit
  nsExec::ExecToLog 'taskkill /F /IM "Hanako.exe"'
  nsExec::ExecToLog 'taskkill /F /IM "hana-server.exe"'
  Sleep 2000
!macroend
