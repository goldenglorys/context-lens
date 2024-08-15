import fs from "fs";
import path from "path";
import ndjson from "ndjson";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { ssgParams } from "hono/ssg";

const ASSETS_DIR = "./assets";

const getJsonlFiles = (): string[] => {
  return fs.readdirSync(ASSETS_DIR).filter(file => file.endsWith('.jsonl'));
};

const getData = async (filename: string, id?: string): Promise<any> => {
  return new Promise((resolve, reject) => {
    const data: any[] = [];
    fs.createReadStream(path.join(ASSETS_DIR, filename))
      .pipe(ndjson.parse())
      .on("data", (obj) => {
        if (!id || (obj.id === id) || (obj.meta && obj.meta.id === id)) {
          data.push(obj);
        }
      })
      .on("end", () => {
        if (id) {
          resolve(data[0] || null);
        } else {
          resolve(data);
        }
      })
      .on("error", (err) => reject(err));
  });
};

const getMetadata = async (filename: string): Promise<any[]> => {
  const data = await getData(filename);
  return data.map((item: { id?: any; meta?: any; messages?: any; }, index: any) => ({
    id: item.id || item.meta?.id || `item-${index}`,
    num_items: item.messages?.length || Object.keys(item).length,
    ...item.meta,
    keys: Object.keys(item),
  }));
};

const app = new Hono();

app.get("/", async (c) => {
  const files = getJsonlFiles();
  const allMeta = await Promise.all(files.map(async file => ({
    file,
    meta: await getMetadata(file)
  })));

  return c.html(`
<!DOCTYPE html>
<html>
<head>
  <title>JSONL Viewer</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100 p-8">
  <h1 class="text-3xl font-bold mb-6">JSONL Viewer</h1>
  ${allMeta.map(({file, meta}) => `
    <div class="bg-white shadow-md rounded-lg p-6 mb-8">
      <h2 class="text-2xl font-semibold mb-4">${file}</h2>
      <table class="w-full">
        <thead>
          <tr class="bg-gray-200">
            <th class="p-2 text-left">ID</th>
            <th class="p-2 text-left">Items</th>
            <th class="p-2 text-left">Keys</th>
          </tr>
        </thead>
        <tbody>
          ${meta.map((m) => `
            <tr class="border-b">
              <td class="p-2"><a href="/view/${file}/${encodeURIComponent(m.id)}" class="text-blue-500 hover:underline">${m.id}</a></td>
              <td class="p-2">${m.num_items || 'N/A'}</td>
              <td class="p-2">${m.keys.join(', ')}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `).join("")}
</body>
</html>
`);
});

const displayContent = (data: any): string => {
  if (!data) {
    return '<p class="text-red-500">No data found for this ID.</p>';
  }

  if (Array.isArray(data.messages)) {
    return data.messages.map((msg: any, index: number) => `
      <div id="message-${index}" class="mb-4">
        <div class="sticky top-0 bg-white/80 backdrop-blur-md py-2 mb-2">
          <div class="flex justify-between">
            <div class="font-bold">${msg.role || 'Unknown'}</div>
            <div>${index + 1} of ${data.messages.length}</div>
          </div>
        </div>
        <div class="p-4 rounded-md ${
          msg.role === "assistant" ? "bg-gray-200" :
          msg.role === "system" ? "bg-pink-400 text-white" :
          "bg-blue-500 text-white"
        } break-words whitespace-pre-wrap font-mono">
          ${msg.content || JSON.stringify(msg, null, 2)}
        </div>
      </div>
    `).join("");
  } else {
    return `
      <div class="bg-white p-4 rounded-md shadow">
        <pre class="whitespace-pre-wrap">${JSON.stringify(data, null, 2)}</pre>
      </div>
    `;
  }
};

app.get(
  "/view/:file/:id",
  ssgParams(async () => {
    const files = getJsonlFiles();
    const allParams = await Promise.all(files.map(async file => {
      const meta = await getMetadata(file);
      return meta.map(m => ({ file, id: m.id }));
    }));
    return allParams.flat();
  }),
  async (c) => {
    const file = c.req.param("file");
    const id = decodeURIComponent(c.req.param("id"));

    try {
      const data = await getData(file, id);
      const meta = await getMetadata(file);
      const currentIndex = meta.findIndex(m => m.id === id);
      const prevId = currentIndex > 0 ? meta[currentIndex - 1].id : null;
      const nextId = currentIndex < meta.length - 1 ? meta[currentIndex + 1].id : null;

      return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${id} | JSONL Viewer</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100">
  <div class="container mx-auto p-8">
    <div id="top" class="mb-8">
      <a href="/" class="text-blue-500 hover:underline">← Back to Index</a> 
      <h1 class="text-3xl font-bold mt-4">Viewing: ${file}</h1>
      <h2 class="text-2xl font-semibold">${id}</h2>
      <div class="flex justify-between mt-4">
        ${prevId ? `<a href="/view/${file}/${encodeURIComponent(prevId)}" class="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">Previous</a>` : '<span></span>'}
        ${nextId ? `<a href="/view/${file}/${encodeURIComponent(nextId)}" class="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">Next</a>` : '<span></span>'}
      </div>
    </div>
    <div class="bg-white shadow-md rounded-lg p-6">
      ${displayContent(data)}
    </div>
    <div class="mt-8">
      <a href="#top" class="text-blue-500 hover:underline">Back to Top</a>
    </div>
  </div>
</body>
</html>
`);
    } catch (e: any) {
      return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Error | JSONL Viewer</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100">
  <div class="container mx-auto p-8">
    <a href="/" class="text-blue-500 hover:underline">← Back to Index</a> 
    <h1 class="text-3xl font-bold mt-4 text-red-500">Error</h1>
    <p class="mt-4">${e.message || 'An unknown error occurred'}</p>
  </div>
</body>
</html>
      `, 500);
    }
  }
);

app.get("/api/:file/:id", async (c) => {
  const file = c.req.param("file");
  const id = decodeURIComponent(c.req.param("id"));

  try {
    const data = await getData(file, id);
    if (!data) {
      return c.json({ error: "Not found" }, 404);
    }
    return c.json(data);
  } catch (e: any) {
    return c.json({ error: e.message || 'An unknown error occurred' }, 500);
  }
});

console.log("Starting server on http://localhost:8787");

serve({
  fetch: app.fetch,
  port: 8787,
});

export default app;