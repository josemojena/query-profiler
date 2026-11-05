import { toolbarScript } from "../ui/snippet.js";

/** The script that puts the bar on a page served by the middleware. */
export function toolbarSnippet(base: string, token: string): string {
  // React hydrates the whole document: the script removes itself before that.
  return `<script>document.currentScript.remove();${toolbarScript(base, token)}</script>`;
}

/** Inserts `snippet` before `</body>`, or at the end if there is none, without buffering the page. */
export function injectBeforeBodyEnd(
  body: ReadableStream<Uint8Array>,
  snippet: string,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const closing = "</body>";
  let pending = "";
  let done = false;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (done) return controller.enqueue(chunk);
        pending += decoder.decode(chunk, { stream: true });
        const at = pending.indexOf(closing);
        if (at >= 0) {
          controller.enqueue(encoder.encode(pending.slice(0, at) + snippet + pending.slice(at)));
          pending = "";
          done = true;
        } else if (pending.length > closing.length) {
          controller.enqueue(encoder.encode(pending.slice(0, -closing.length)));
          pending = pending.slice(-closing.length);
        }
      },
      flush(controller) {
        const rest = pending + decoder.decode();
        controller.enqueue(encoder.encode(done ? rest : rest + snippet));
      },
    }),
  );
}
