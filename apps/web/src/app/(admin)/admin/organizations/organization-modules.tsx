"use client";

import { useState, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ResultNotice } from "@/components/form-bits";
import { setOrganizationModuleAction, type ModuleActionResult } from "../module-actions";

/** Organizations × modules grid of entitlement switches (system admins only). */
export function OrganizationModulesTable({
  organizations,
  modules,
}: {
  organizations: Array<{ id: string; name: string; modules: string[] }>;
  modules: Array<{ key: string; name: string; description: string }>;
}) {
  const [result, setResult] = useState<ModuleActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="grid gap-3">
      {result ? (
        <div className="px-5 pt-4">
          <ResultNotice result={result} />
        </div>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Organization</TableHead>
            {modules.map((module) => (
              <TableHead key={module.key} className="text-center">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-help">{module.name}</span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">{module.description}</TooltipContent>
                </Tooltip>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {organizations.map((org) => (
            <TableRow key={org.id}>
              <TableCell className="font-medium">{org.name}</TableCell>
              {modules.map((module) => (
                <TableCell key={module.key} className="text-center">
                  <Switch
                    aria-label={`${module.name} for ${org.name}`}
                    checked={org.modules.includes(module.key)}
                    disabled={pending}
                    onCheckedChange={(enabled) => startTransition(async () => setResult(await setOrganizationModuleAction(org.id, module.key, enabled)))}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
