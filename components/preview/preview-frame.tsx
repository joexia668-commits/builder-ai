"use client";

import {
  SandpackProvider,
  SandpackPreview,
  SandpackLayout,
} from "@codesandbox/sandpack-react";
import { SandpackErrorBoundary } from "@/components/preview/error-boundary";
import { buildSandpackConfig } from "@/lib/sandpack-config";

interface PreviewFrameProps {
  code: string;
  projectId: string;
}

export function PreviewFrame({ code, projectId }: PreviewFrameProps) {
  const config = buildSandpackConfig(code, projectId);
  // SandpackProvider only reads `files` on mount — changing the key forces a full
  // remount whenever the code changes, so the sandbox always reflects the latest code.
  const sandpackKey = `${code.length}-${code.slice(0, 40)}`;

  return (
    <SandpackErrorBoundary>
      <SandpackProvider
        key={sandpackKey}
        template={config.template as "react"}
        files={config.files}
        options={config.options}
        customSetup={config.customSetup}
        theme={config.theme as "auto"}
      >
        <SandpackLayout style={{ height: "100%", border: "none" }}>
          <SandpackPreview
            style={{ height: "100%" }}
            showNavigator={false}
            showOpenInCodeSandbox={false}
            showRefreshButton
          />
        </SandpackLayout>
      </SandpackProvider>
    </SandpackErrorBoundary>
  );
}
