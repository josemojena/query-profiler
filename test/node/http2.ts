import { connect } from "node:http2";

/** Whether this Node publishes HTTP/2 server streams on its diagnostics channels: 22.17+, 24.2+. */
export function http2Channels(): boolean {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  return major > 24 || (major === 24 && minor >= 2) || (major === 22 && minor >= 17);
}

/** GETs `path` over cleartext HTTP/2, and gives the response's status. */
export function http2Get(origin: string, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const client = connect(origin);
    client.on("error", reject);
    const request = client.request({ ":path": path });
    let status = 0;
    request.on("response", (headers) => (status = Number(headers[":status"])));
    request.on("data", () => {});
    request.on("end", () => {
      client.close();
      resolve(status);
    });
    request.end();
  });
}
