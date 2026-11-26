import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Empty, Section } from "@/components/workspace/presentation";
import { ProfileHeader } from "@/components/workspace/profile-header";
import { TrainingList } from "@/components/workspace/workplace-training";
import { employeeProfile } from "@/lib/server/directory";
import { requireMember } from "@/lib/server/member";
import { employeeTraining } from "@/lib/server/training";

export const metadata: Metadata = { title: "Training record" };

export default async function ProfileTrainingPage({ params }: { params: Promise<{ id: string }> }) {
  const member = await requireMember();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [profile, training] = await Promise.all([employeeProfile(member, id), employeeTraining(member, id)]);
  if (!profile || !training) notFound();
  const open = training.assignments.filter((entry) => entry.state === "open");
  const done = training.assignments.filter((entry) => entry.state === "completed");
  return <>
    <ProfileHeader employee={profile.employee} current="training" canSeePrivate={training.full} />
    <Section title="To do" className="mb-9">{open.length ? <TrainingList entries={open} open={member.employeeId === id} /> : <Empty>No training is open.</Empty>}</Section>
    <Section title="Completed">{done.length ? <TrainingList entries={done} /> : <Empty>No training completed yet.</Empty>}</Section>
    {!training.full && <p className="mt-6 text-[13px] text-muted">Managers see whether training is done. Scores stay with the person and administrators.</p>}
  </>;
}
