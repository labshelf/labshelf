; Builds labshelf-helper-windows-setup.exe, a per-user installer that lays the helper into its data folder's bin\ and registers it.
; Build: iscc /DAppVersion=<version> /DSourceBinary=<path to labshelf-helper-windows-x64.exe> /DOutputDir=<output dir> labshelf-helper.iss

#ifndef AppVersion
  #error Pass /DAppVersion=<version>
#endif
#ifndef SourceBinary
  #error Pass /DSourceBinary=<path to the helper executable>
#endif
#ifndef OutputDir
  #error Pass /DOutputDir=<output dir>
#endif

[Setup]
AppId={{6C1F0B6E-4B7A-4E0F-9D55-3E2A8F5B7A10}
AppName=LabShelf Helper
AppVersion={#AppVersion}
AppPublisher=LabShelf
; The data folder of documents/contracts/helper.md; bin\ holds the executable.
DefaultDirName={localappdata}\LabShelf Helper\bin
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=labshelf-helper-windows-setup
Compression=lzma2
SolidCompression=yes

[Tasks]
Name: "installpython"; Description: "Install Python for calculations in notes"; Flags: unchecked

[Files]
Source: "{#SourceBinary}"; DestDir: "{app}"; DestName: "labshelf-helper.exe"; Flags: ignoreversion

[Run]
Filename: "{app}\labshelf-helper.exe"; Parameters: "--register"; Flags: runhidden waituntilterminated
; A failed Python install never fails the helper install: the exit code is ignored, and the browser offers the install again.
Filename: "{app}\labshelf-helper.exe"; Parameters: "--install-python"; Tasks: installpython; StatusMsg: "Installing Python..."; Flags: runhidden waituntilterminated

[UninstallRun]
Filename: "{app}\labshelf-helper.exe"; Parameters: "--unregister"; Flags: runhidden waituntilterminated; RunOnceId: "UnregisterHelper"

; The helper replaces its own executable on update and leaves these behind.
[UninstallDelete]
Type: files; Name: "{app}\labshelf-helper.exe.old"
Type: files; Name: "{app}\labshelf-helper.exe.new"
