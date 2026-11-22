; Additions to the installer (electron-builder.yml, nsis.include): "Open in studiomio" in the
; right-click menu of the folders and of the empty space inside a folder, to open a project folder
; directly. The installation is per user, so it goes in the current user's classes; uninstalling
; removes it.

!macro customInstall
  WriteRegStr SHCTX "Software\Classes\Directory\shell\studiomio" "" "Open in studiomio"
  WriteRegStr SHCTX "Software\Classes\Directory\shell\studiomio" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\Directory\shell\studiomio\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr SHCTX "Software\Classes\Directory\Background\shell\studiomio" "" "Open in studiomio"
  WriteRegStr SHCTX "Software\Classes\Directory\Background\shell\studiomio" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\Directory\Background\shell\studiomio\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%V"'
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\Classes\Directory\shell\studiomio"
  DeleteRegKey SHCTX "Software\Classes\Directory\Background\shell\studiomio"
!macroend
