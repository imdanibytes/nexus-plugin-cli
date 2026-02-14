"use strict";

module.exports = function pluginJson(config) {
  const manifest = {
    id: config.id,
    name: config.name,
    version: "0.1.0",
    description: config.description,
    author: config.author,
    license: "MIT",
    homepage: "",
    image: `ghcr.io/${config.author.toLowerCase().replace(/[^a-z0-9-]/g, "")}/nexus-plugin-${config.slug}:0.1.0`,
    ui: {
      port: config.port,
      path: "/",
    },
    permissions: config.permissions,
    health: {
      endpoint: "/health",
      interval_secs: 30,
    },
    env: {},
    min_nexus_version: "0.3.0",
  };

  if (config.includeMcp) {
    manifest.mcp = {
      tools: [
        {
          name: "example_tool",
          description: `An example tool for ${config.name}`,
          permissions: [],
          input_schema: {
            type: "object",
            properties: {
              message: {
                type: "string",
                description: "An example input parameter",
              },
            },
            required: ["message"],
          },
        },
      ],
    };
  }

  if (config.includeSettings) {
    manifest.settings = [
      {
        key: "greeting",
        type: "string",
        label: "Greeting Text",
        description: "Custom greeting displayed in the UI",
        default: `Hello from ${config.name}!`,
      },
    ];
  } else {
    manifest.settings = [];
  }

  return JSON.stringify(manifest, null, 2) + "\n";
};
