import Link from "next/link";
import { EmptyState } from "@/components/workspace/presentation";
import { secondaryButton } from "@/components/ui";

export default function WorkspaceNotFound() {
  return <EmptyState title="This page is unavailable" description="The record may have moved, or your account may not have access to it." action={<Link href="/workspace/people" className={secondaryButton}>Open people directory</Link>} />;
}
