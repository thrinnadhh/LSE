const { config } = require("./config");
const { ApiError } = require("./errors");

async function openSearchRequest(path, options = {}) {
  const response = await fetch(`${config.searchClusterUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new ApiError(502, data?.error?.reason || data?.error?.type || `OpenSearch request failed: ${response.status}`);
  }

  return data;
}

module.exports = { openSearchRequest };