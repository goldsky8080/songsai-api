import Section from "./components/Section";
import Markdown from "react-markdown";

export default function Home() {
  const markdown = `
---
## Introduction

SONGS API is a wrapper project for AI music generation workflows. It is built on top of the upstream engine and makes it easier to integrate music generation into internal tools and agents.

This project is used as the wrapper layer behind the SongsAI service.

## Features

- Wraps the music generation flow behind a simple HTTP API
- Supports custom generation mode
- Supports lyrics generation and status lookup
- Can be integrated into agent workflows and internal tools
- Keeps the integration layer separate from the main web app

## Getting Started

### 1. Obtain the cookie of your music account

1. Head over to the create page in your browser.
2. Open the browser developer tools with \`F12\`.
3. Navigate to the \`Network\` tab.
4. Refresh the page.
5. Identify the request that includes the session bootstrap keyword.
6. Open the request headers.
7. Copy the full \`Cookie\` header value.
`;

  const markdownPart2 = `
### 2. Clone and deploy this project

#### Run locally

\`\`\`bash
git clone https://github.com/gcui-art/suno-api.git
cd suno-api
npm install
\`\`\`

### 3. Configure SONGS API

Add the cookie to your local \`.env\` file.

\`\`\`bash
SUNO_COOKIE=<your-cookie>
\`\`\`

### 4. Run SONGS API

- Run \`npm run dev\`.
- Visit \`http://localhost:3000/api/get_limit\` for testing.

### 5. Use the API

Check the API docs page for endpoint details and interactive testing.

## API Reference

Main endpoints:

\`\`\`bash
- /api/generate
- /api/custom_generate
- /api/generate_lyrics
- /api/get
- /api/get_limit
- /api/extend_audio
- /api/generate_stems
- /api/get_aligned_lyrics
- /api/concat
- /api/persona
\`\`\`
`;

  return (
    <>
      <Section className="">
        <div className="flex flex-col m-auto py-20 text-center items-center justify-center gap-4 my-8 lg:px-20 px-4 bg-indigo-900/90 rounded-2xl border shadow-2xl hover:shadow-none duration-200">
          <span className=" px-5 py-1 text-xs font-light border rounded-full border-white/20 uppercase text-white/50">
            Unofficial
          </span>
          <h1 className="font-bold text-7xl flex text-white/90">SONGS API</h1>
          <p className="text-white/80 text-lg">
            A wrapper service for integrating AI music generation into SongsAI and internal tools.
          </p>
        </div>
      </Section>
      <Section className="my-10">
        <article className="prose lg:prose-lg max-w-3xl">
          <Markdown>{markdown}</Markdown>
          <video controls width="1024" className="w-full border rounded-lg shadow-xl">
            <source src="/get-cookie-demo.mp4" type="video/mp4" />
            Your browser does not support frames.
          </video>
          <Markdown>{markdownPart2}</Markdown>
        </article>
      </Section>
    </>
  );
}
