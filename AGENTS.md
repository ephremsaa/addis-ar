
- Use TanStack Start with React for the application shell and client-only React Three Fiber for the scene editor, because the hosted workspace requires this stack.
- Keep local project persistence in IndexedDB and scene data in validated serializable modules, because editing must not require an account or online service.
- Keep project management, scene rendering, editor controls, and project export separate, because AR engines must be added without rewriting the editor.
