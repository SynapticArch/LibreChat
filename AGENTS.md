# Repository Guidelines

Regarding the garbled characters issue you mentioned, I've confirmed it's not a file corruption problem. In PowerShell, you can read it directly like this:

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$OutputEncoding = [System.Text.Encoding]::UTF8

Get-Content -Encoding UTF8 src\controllers\ttsController.ts

## Commit & Pull Request Guidelines

Use conventional commit messages matching the project history: `feat: add feature`, `fix: resolve issue`, `docs: update guide`, or `chore: maintenance`. Reference related issues or alerts in the commit message when relevant. Pull requests should describe the change, list verification performed, link issues, and include screenshots for visible frontend changes.

After each modification to the code, a commit must be made and the changes pushed to the remote repository.
