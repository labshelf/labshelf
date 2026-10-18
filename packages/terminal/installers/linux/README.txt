LabShelf Helper

The helper builds LaTeX projects for the LabShelf browser extension.

Install for your user:

  1. Put labshelf-helper where you want to keep it, for example
     ~/.local/share/labshelf-helper/bin/ (create the folder first).
  2. Run: ./labshelf-helper --register

--register writes the native messaging host manifests (helper and bridge) for each browser found
in your home directory. To remove the registration, run: ./labshelf-helper --unregister

To remove the helper entirely, run: ./labshelf-helper --uninstall

--uninstall unregisters both hosts, deletes the labshelf-bridge name next to the binary and the bin/
folder in the helper's data folder (~/.local/share/labshelf-helper/bin/). Your projects and the shared
managed tools folder stay. Delete the binary yourself if you put it somewhere else.
