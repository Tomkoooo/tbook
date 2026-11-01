"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { ResultNotice } from "@/components/form-bits";
import { acceptInviteAction } from "./actions";

export function AcceptInviteForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(async () => acceptInviteAction(token), null);
  return (
    <form action={action} className="grid gap-3">
      <ResultNotice result={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Joining…" : "Accept invitation"}
      </Button>
    </form>
  );
}
