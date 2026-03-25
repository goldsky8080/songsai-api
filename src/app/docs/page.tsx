import React from "react";
import Swagger from "../components/Swagger";
import spec from "./swagger-suno-api.json";
import Section from "../components/Section";
import Markdown from "react-markdown";

export default function Docs() {
  return (
    <>
      <Section className="my-10">
        <article className="prose lg:prose-lg max-w-3xl pt-10">
          <h1 className=" text-center text-indigo-900">API Docs</h1>
          <Markdown>{`
---
SONGS API currently exposes the following main endpoints:

\`\`\`bash
- /api/generate
- /v1/chat/completions
- /api/custom_generate
- /api/generate_lyrics
- /api/get
- /api/get_limit
- /api/extend_audio
- /api/generate_stems
- /api/get_aligned_lyrics
- /api/clip
- /api/concat
- /api/persona
\`\`\`

Feel free to explore the detailed API parameters and test them on this page.
          `}</Markdown>
        </article>
      </Section>
      <Section className="my-10">
        <article className="prose lg:prose-lg max-w-3xl py-10">
          <h2 className="text-center">API details and online testing</h2>
          <p className="text-red-800 italic">
            This is a demo wrapper UI bound to a test account. Please avoid excessive use.
          </p>
        </article>

        <div className=" border p-4 rounded-2xl shadow-xl hover:shadow-none duration-200">
          <Swagger spec={spec} />
        </div>
      </Section>
    </>
  );
}
