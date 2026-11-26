import { repositoryUrl } from "@/components/brand";
import { CopyButton } from "./copy-button";

// Keep these commands in step with the self-host section of README.md.
const steps = [
  { title: "Get the source", commands: `git clone ${repositoryUrl}.git\ncd openwarp` },
  {
    title: "Generate secrets",
    commands: `umask 077
cat > .env <<ENV
POSTGRES_PASSWORD=$(openssl rand -hex 32)
OPENWARP_DB_PASSWORD=$(openssl rand -hex 32)
BETTER_AUTH_SECRET=$(openssl rand -hex 32)
OPENWARP_DATA_KEY=$(openssl rand -hex 32)
OPENWARP_PORT=3080
BETTER_AUTH_URL=http://127.0.0.1:3080
OPENWARP_WORKSPACE_NAME=People workspace
ENV`,
  },
  { title: "Start the stack", commands: "docker compose up -d --build --wait" },
];

export function SetupSteps() {
  return (
    <ol className="min-w-0 overflow-hidden rounded-[10px] border border-line-strong bg-panel">
      {steps.map(({ title, commands }, index) => (
        <li key={title} className="border-b border-line last:border-b-0">
          <div className="flex min-h-12 items-center justify-between gap-3 pt-2 pr-2.5 pl-5">
            <h3 className="flex items-center gap-3 text-sm font-semibold"><span aria-hidden="true" className="text-muted tabular-nums">{index + 1}</span>{title}</h3>
            <CopyButton text={commands} label={`Copy the commands to ${title.toLowerCase()}`} />
          </div>
          <pre tabIndex={0} aria-label={`Commands to ${title.toLowerCase()}`} role="region" className="overflow-x-auto px-5 pt-1.5 pb-5 font-mono text-[13px] leading-6 text-muted focus-visible:outline-offset-[-3px]"><code>{commands}</code></pre>
        </li>
      ))}
    </ol>
  );
}
