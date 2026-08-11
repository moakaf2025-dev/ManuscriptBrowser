; Put the program in the "Open with" list, and nowhere else.
;
; Deliberately not electron-builder's `fileAssociations`. That one writes the
; default value of Software\Classes\.pdf, which is a claim on the extension
; itself: every PDF the reader double-clicks would come here. Whether it takes
; effect at all depends on whether Windows already recorded a UserChoice for
; .pdf, so the same installer would seize the extension on one machine and not
; on the next - and a program that sometimes hijacks PDFs is worse than one that
; always does, because nobody can predict it.
;
; What is written here instead is the Applications\<exe> form: it adds an entry
; to the "Open with" menu and to "Choose another app", and touches no default.
; The reader decides, and can still make it the default through Windows if they
; want to.
;
; "%1" is the file path Windows appends. main.js picks it out of process.argv,
; and the single-instance lock hands it to the copy already running.

!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "متصفح المخطوطات"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\DefaultIcon" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open" "FriendlyAppName" "متصفح المخطوطات"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'

  ; Offered for these, and only these. Without SupportedTypes Windows offers the
  ; program for every file there is, including ones it cannot open.
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".pdf" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".zip" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".rar" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".7z" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".jpg" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".jpeg" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".png" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".tif" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".tiff" ""
!macroend

!macro customUnInstall
  ; Everything written above lives under this one key, so the uninstall leaves
  ; nothing behind. The reader's notes are not here - those are in %APPDATA% and
  ; deleteAppDataOnUninstall is off.
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
!macroend
