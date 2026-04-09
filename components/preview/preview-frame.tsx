"use client";

import {
  SandpackProvider,
  SandpackPreview,
  SandpackLayout,
} from "@codesandbox/sandpack-react";
import { SandpackErrorBoundary } from "@/components/preview/error-boundary";
import { buildSandpackConfig } from "@/lib/sandpack-config";

interface PreviewFrameProps {
  files: Record<string, string>;
  projectId: string;
}

export function PreviewFrame({ files, projectId }: PreviewFrameProps) {
  const config = buildSandpackConfig(files, projectId);
  const appCode = files["/App.js"] ?? "";
  const sandpackKey = `${Object.keys(files).length}-${appCode.length}-${appCode.slice(0, 40)}`;

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
