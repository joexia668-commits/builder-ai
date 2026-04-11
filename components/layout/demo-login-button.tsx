"use client";

import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function DemoLoginButton() {
  return (
    <Button
      variant="outline"
      onClick={() => signIn("demo", { callbackUrl: "/" })}
      className="w-full h-[42px] rounded-[10px] border-[1.5px] border-[#e5e7eb] text-[#6b7280] hover:border-[#d1d5db] hover:text-[#374151] duration-150"
    >
      查看演示项目
    </Button>
  );
}
