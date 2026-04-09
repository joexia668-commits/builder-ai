import type { Config } from "jest";

const config: Config = {
  testEnvironment: "node",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  transform: {
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        tsconfig: {
          jsx: "react-jsx",
          esModuleInterop: true,
          module: "commonjs",
          moduleResolution: "node",
        },
      },
    ],
  },
  testMatch: ["**/__tests__/**/*.test.(ts|tsx)"],
  testPathIgnorePatterns: ["/node_modules/", "/.worktrees/"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  projects: [
    {
      displayName: "node",
      testEnvironment: "node",
      testMatch: ["**/__tests__/**/*.test.ts"],
      testPathIgnorePatterns: ["/node_modules/", "/.worktrees/"],
      moduleNameMapper: { "^@/(.*)$": "<rootDir>/$1" },
      transform: {
        "^.+\\.ts$": [
          "ts-jest",
          {
            tsconfig: {
              esModuleInterop: true,
              module: "commonjs",
              moduleResolution: "node",
            },
          },
        ],
      },
    },
    {
      displayName: "jsdom",
      testEnvironment: "jsdom",
      testMatch: ["**/__tests__/**/*.test.tsx"],
      testPathIgnorePatterns: ["/node_modules/", "/.worktrees/"],
      moduleNameMapper: { "^@/(.*)$": "<rootDir>/$1" },
      transform: {
        "^.+\\.(ts|tsx)$": [
          "ts-jest",
          {
            tsconfig: {
              jsx: "react-jsx",
              esModuleInterop: true,
              module: "commonjs",
              moduleResolution: "node",
            },
          },
        ],
      },
      setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
    },
  ],
};

export default config;
