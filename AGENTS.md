<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Use TanStack Start with React for the application shell and client-only React Three Fiber for the scene editor, because the hosted workspace requires this stack.
- Keep local project persistence in IndexedDB and scene data in validated serializable modules, because editing must not require an account or online service.
- Keep project management, scene rendering, editor controls, and project export separate, because AR engines must be added without rewriting the editor.

- Convert temporary blob model URLs to data URLs at the persistence boundary, because object URLs cannot survive a page reload.
- Use exclusive Scene, Objects and Properties panels on mobile while retaining the three-column desktop editor, because touch editing needs full-width controls and an unobstructed viewport.
- Centralize file downloads and offer explicit file-sharing recovery, because browsers do not reliably report silent WebView download failures.
