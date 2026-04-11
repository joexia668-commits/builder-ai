"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function EmailLoginForm() {
  return (
    <div className="flex flex-col gap-2 w-full">
      <label htmlFor="email-input" className="sr-only">
        邮箱
      </label>
      <Input
        id="email-input"
        type="email"
        placeholder="邮箱登录暂不可用"
        disabled
        className="h-[42px] rounded-[10px] border-[#e5e7eb] text-sm"
      />
      <Button
        type="button"
        variant="outline"
        disabled
        className="w-full h-[42px] rounded-[10px] border-[1.5px] border-indigo-200 text-indigo-600 hover:bg-indigo-50 duration-150"
      >
        发送登录链接
      </Button>
      <p className="text-[11px] text-[#9ca3af] text-center">
        <span aria-hidden="true">📧</span> 域名验证后即可开放使用
      </p>
    </div>
  );
}
