import { repositoryUrl } from "@/components/brand";
import { CopyButton } from "./copy-button";

// Keep these commands in step with the self-host section of README.md.
const steps = [
  {
    title: "Get the source",
    detail: "Clone the repository on the machine that will run OpenWarp.",
    commands: `git clone ${repositoryUrl}.git\ncd openwarp`,
  },
  {
    title: "Generate secrets",
    detail: "Write a private .env with fresh secrets. Back up OPENWARP_DATA_KEY apart from the database: sealed fields can’t be read without it.",
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
  {
    title: "Start the stack",
    detail: "Compose starts PostgreSQL on an internal network, applies the migrations and runs the app as a non-root user.",
    commands: "docker compose up -d --build --wait",
  },
  {
    title: "Create the first administrator",
    detail: "Type a password of at least 12 characters when asked. Then open 127.0.0.1:3080 and sign in.",
    commands: `printf 'Administrator password: ' >&2
IFS= read -rs OPENWARP_ADMIN_PASSWORD
printf '\\n' >&2
printf '%s\\n' "$OPENWARP_ADMIN_PASSWORD" | docker compose run --rm -T migrate \\
  node scripts/account.mjs create --email admin@example.com --name 'Workspace Admin' --role admin
unset OPENWARP_ADMIN_PASSWORD`,
  },
];

// A light pass of shell coloring: variable names, command substitutions and quoted strings.
function Line({ text }: { text: string }) {
  const parts = text.split(/(\$\([^)]*\)|'[^']*'|"[^"]*"|^[A-Z_]+(?==))/g).filter(Boolean);
  return <>{parts.map((part, index) => {
    const tone = part.startsWith("$(") ? "text-term-sub" : /^['"]/.test(part) ? "text-term-string" : /^[A-Z_]+$/.test(part) && index === 0 ? "text-term-key" : undefined;
    return tone ? <span key={index} className={tone}>{part}</span> : part;
  })}</>;
}

export function SetupSteps() {
  return (
    <ol className="min-w-0 border-t border-line">
      {steps.map(({ title, detail, commands }, index) => (
        <li key={title} className="grid min-w-0 gap-x-6 gap-y-1.5 border-b border-line py-8 sm:grid-cols-[2.5rem_minmax(0,1fr)]">
          <span aria-hidden="true" className="font-mono text-[13px] leading-[1.6rem] text-hint tabular-nums">{String(index + 1).padStart(2, "0")}</span>
          <div className="min-w-0">
            <h3 className="text-[17px] leading-[1.6rem] font-semibold">{title}</h3>
            <p className="mt-1 max-w-[60ch] text-[15px] leading-relaxed text-pretty text-muted">{detail}</p>
            <div className="relative mt-4 rounded-lg border border-term-edge bg-term text-term-ink">
              <pre tabIndex={0} aria-label={`Commands to ${title.toLowerCase()}`} role="region" className="overflow-x-auto rounded-lg py-3.5 pr-24 pl-4 font-mono text-[13px] leading-6 focus-visible:outline-term-key focus-visible:outline-offset-[-3px]"><code>{commands.split("\n").map((line, row) => <span key={row} className="block"><Line text={line} /></span>)}</code></pre>
              <div className="absolute top-1.5 right-1.5 rounded-[7px] bg-term">
                <CopyButton text={commands} label={`Copy the commands to ${title.toLowerCase()}`} className="text-term-muted hover:bg-term-hover hover:text-term-ink focus-visible:outline-term-key" />
              </div>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
