import { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";

/** CodeMirror 6 editor (lazy-loaded). Controlled-ish: reports every change, never fights the cursor. */
export default function CodeEditor({ value, lang, dark, onChange }: { value: string; lang: "html" | "markdown"; dark: boolean; onChange: (v: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          lang === "html" ? html() : markdown(),
          EditorView.lineWrapping,
          ...(dark ? [oneDark] : []),
          EditorView.updateListener.of((u) => u.docChanged && cb.current(u.state.doc.toString())),
          EditorView.contentAttributes.of({ "aria-label": lang === "html" ? "Live object source" : "Document source" }),
          EditorView.domEventHandlers({ keydown: (e) => (e.stopPropagation(), false) }),
        ],
      }),
    });
    (window as any).__lumenEditor = view; // test/debug handle
    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, dark]);
  return <div className="cm-host" ref={host} data-testid="live-source" />;
}
