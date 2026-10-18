LabShelf Helper

The helper builds LaTeX projects for the LabShelf browser extension.

Install for your user:

  1. Put labshelf-helper where you want to keep it, for example
     ~/.local/share/labshelf-helper/bin/ (create the folder first).
  2. Run: ./labshelf-helper --register

--register writes the native messaging host manifests (helper and bridge) for each browser found
in your home directory. To remove it, run: ./labshelf-helper --unregister
