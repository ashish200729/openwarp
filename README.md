# OpenWarp

OpenWarp is a self-hosted employee directory and people operations workspace. It uses Next.js, React, TypeScript and Tailwind CSS. The source is licensed under [AGPL-3.0-only](LICENSE).

This first phase publishes the landing page and its sample workspace preview. The employee workspace and PostgreSQL deployment are the next phase of v0.1.

## Self-host

```sh
nvm use
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000).

## Optional Breeze UI Readout

The public build works with an ordinary `npm ci`. Developers licensed for Breeze UI can enable the original Readout behind the hero chart in a local checkout.

1. Put your own `BREEZE_TOKEN` in `.env.local`. The `@breeze` registry in `components.json` passes it in the Authorization header.
2. Run `npx shadcn@latest add @breeze/readout` in the project root. Keep the CLI-created file and its license notices intact.
3. Add `OPENWARP_ENABLE_BREEZE_READOUT=1` to `.env.local` and restart the development server or rebuild.

Keep your token, Breeze source and licensed builds out of public repositories and artifacts. Refer to the [installation guide](https://www.breezeui.com/docs/installation.md) and [Breeze UI license](https://www.breezeui.com/license).
