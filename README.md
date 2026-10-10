# Technical Manual Catalog

A lightweight local catalog for finding technical manuals and related files
across a drive with deeply nested or inconsistent folders. It provides one
place to browse the existing directory structure, search filenames and paths,
and open files without rebuilding or reorganizing the original manuals.

## The Problem

Technical documentation is often spread across folders with different
structures and file types. Some collections include complete HTML manual
interfaces; others contain individual documents and supporting assets. Finding
the right item by manually opening folders can be slow and frustrating.

## Current Prototype

The app scans a selected directory at runtime and presents its visible files
and folders in a browser-based catalog. It supports:

- Browsing nested folders, with folder contents loaded as needed.
- Searching filenames and full paths across the scan.
- Opening existing HTML manuals and individual documents from their original
  locations.
- Paginating large folders and search results.
- Rescanning the drive after files are added.
- Showing document, file, and folder counts, along with scan warnings.

The server uses Node.js built-in modules and listens only on the local computer.
It does not copy, move, or modify the source files. Hidden entries and symbolic
links are excluded from the scan.

## Run the Catalog

Requires Node.js. No package installation is needed.

1. Connect or mount the drive containing the documentation.
2. From this project directory, start the server and pass the drive path:

   ```sh
   node server.js "/path/to/flash-drive"
   ```

   If the drive is the current working directory, omit the path. You can also
   set the root with the `CATALOG_ROOT` environment variable.

3. Open <http://127.0.0.1:4317>.
4. Use **Rescan drive** to refresh the catalog after adding files.
5. Stop the server with Ctrl+C.

On Linux, a mounted drive path often looks like
`/media/your-user/DRIVE_NAME`. On Windows, pass a drive path such as `E:\`.
Set the `PORT` environment variable to use a different port.

## Status and Next Steps

**Initial working prototype.** Runtime directory discovery, browsing, search,
and direct file access are implemented. The next step is to make the approach
reusable across collections, for example by adding a generator that exports a
portable static catalog.

Other potential improvements include identifying the primary entry page for
HTML manuals, validating links within the collection, and supporting convenient
mobile or offline access. The current layout is responsive, but the local-only
server is not available to other devices on the network and requires the server
to be running.

## Lessons

This prototype explores how a small, focused tool can reduce friction in an
existing workflow without replacing the underlying documentation system.
Preserving the original manuals and their folder structure keeps the catalog
lightweight while making the collection easier to navigate.
