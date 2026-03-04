import express from "express";
import { createServer as createViteServer } from "vite";
import { createServer } from "http";
import { Server } from "socket.io";
import WebTorrent from "webtorrent";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, "torrents.json");

// Initialize WebTorrent client
const client = new WebTorrent();

// Persistence helpers
function saveState() {
  try {
    const magnets = client.torrents.map((t) => t.magnetURI);
    fs.writeFileSync(STATE_FILE, JSON.stringify(magnets, null, 2));
  } catch (err) {
    console.error("Failed to save state:", err);
  }
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = fs.readFileSync(STATE_FILE, "utf-8");
      const magnets = JSON.parse(data);
      console.log(`Restoring ${magnets.length} torrents...`);
      
      magnets.forEach((magnet: string) => {
        try {
          client.add(magnet, { path: "/tmp/webtorrent" }, (t) => {
            console.log(`Restored: ${t.infoHash}`);
          });
        } catch (err) {
          console.error("Failed to restore torrent:", err);
        }
      });
    }
  } catch (err) {
    console.error("Failed to load state:", err);
  }
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer);
  const PORT = 3000;

  app.use(express.json());

  // Global error handler for WebTorrent client
  client.on("error", (err) => {
    console.error("WebTorrent Client Error:", err);
  });

  // Load previous state
  loadState();

  // --- API Routes ---

  // Add a torrent
  app.post("/api/torrent", (req, res) => {
    const { magnet } = req.body;
    if (!magnet) {
      return res.status(400).json({ error: "Magnet link is required" });
    }

    console.log(`Received magnet link: ${magnet.substring(0, 50)}...`);

    try {
      // Attempt to add
      const torrent = client.add(magnet, { path: "/tmp/webtorrent" }, (t) => {
        console.log("Torrent metadata ready:", t.infoHash);
        saveState(); // Save on successful add
        
        io.emit("torrent:added", {
          infoHash: t.infoHash,
          name: t.name,
        });
      });

      if (!torrent) {
         throw new Error("Failed to create torrent instance");
      }

      console.log("Torrent added to client:", torrent.infoHash);
      saveState(); // Save immediately just in case
      res.json({ status: "queued", infoHash: torrent.infoHash });
    } catch (err: any) {
      console.error("Error adding torrent:", err.message);
      
      // If it's a duplicate, try to find it and return success
      if (err.message && err.message.includes("Torrent cannot be added to client")) {
         const existing = client.torrents.find(t => t.magnetURI === magnet || magnet.includes(t.infoHash));
         if (existing) {
             console.log("Found existing torrent:", existing.infoHash);
             return res.json({ status: "exists", infoHash: existing.infoHash });
         }
      }

      res.status(500).json({ error: "Failed to add torrent: " + err.message });
    }
  });

  // Get list of torrents
  app.get("/api/torrents", (req, res) => {
    try {
      const torrents = client.torrents.map((t) => ({
        infoHash: t.infoHash,
        name: t.name,
        progress: t.progress,
        downloadSpeed: t.downloadSpeed,
        uploadSpeed: t.uploadSpeed,
        peers: t.numPeers,
        timeRemaining: t.timeRemaining,
        ready: t.ready,
        files: (t.ready && t.files) ? t.files.map((f, index) => ({
          name: f.name,
          length: f.length,
          index,
        })) : [],
      }));
      res.json(torrents);
    } catch (err) {
      console.error("Error fetching torrents:", err);
      res.status(500).json({ error: "Internal Server Error" });
    }
  });

  // Stream a file
  app.get("/api/stream/:infoHash/:fileIndex", (req, res) => {
    const { infoHash, fileIndex } = req.params;
    
    // Try to find the torrent case-insensitively
    const torrent = client.torrents.find(t => t.infoHash.toLowerCase() === infoHash.toLowerCase());

    if (!torrent) {
      console.log(`Stream request: Torrent not found for infoHash ${infoHash}`);
      console.log(`Available torrents: ${client.torrents.map(t => t.infoHash).join(", ")}`);
      return res.status(404).send("Torrent not found");
    }

    // Debug logging
    console.log(`Stream request for ${infoHash} - File Index: ${fileIndex}`);
    console.log(`Torrent State - Name: ${torrent.name}, Ready: ${torrent.ready}, Files: ${torrent.files ? torrent.files.length : 'undefined'}, Progress: ${torrent.progress}`);

    if (!torrent.files || torrent.files.length === 0) {
      return res.status(404).send(`Torrent metadata not ready or no files found. (Ready: ${torrent.ready})`);
    }

    const index = parseInt(fileIndex);
    if (isNaN(index) || index < 0 || index >= torrent.files.length) {
      return res.status(404).send(`Invalid file index: ${fileIndex}. Max index: ${torrent.files.length - 1}`);
    }

    const file = torrent.files[index];
    
    // Support range requests for video streaming / resuming downloads
    const range = req.headers.range;
    if (!range) {
      res.header("Content-Length", file.length.toString());
      res.header("Content-Type", "application/octet-stream");
      res.header("Content-Disposition", `attachment; filename="${file.name}"`);
      const stream = file.createReadStream();
      stream.pipe(res);
    } else {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : file.length - 1;
      const chunksize = end - start + 1;

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${file.length}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize,
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${file.name}"`,
      });

      const stream = file.createReadStream({ start, end });
      stream.pipe(res);
    }
  });

  // Remove torrent
  app.delete("/api/torrent/:infoHash", (req, res) => {
    const { infoHash } = req.params;
    const torrent = client.get(infoHash);
    if (torrent) {
      torrent.destroy({ destroyStore: true }, (err) => {
        if (err) console.error(err);
        saveState(); // Save after removal
        io.emit("torrent:removed", { infoHash });
        res.json({ status: "removed" });
      });
    } else {
      res.status(404).json({ error: "Torrent not found" });
    }
  });

  // --- Socket.io Updates ---
  setInterval(() => {
    const updates = client.torrents.map((t) => ({
      infoHash: t.infoHash,
      name: t.name,
      progress: t.progress,
      downloadSpeed: t.downloadSpeed,
      uploadSpeed: t.uploadSpeed,
      peers: t.numPeers,
      timeRemaining: t.timeRemaining,
      ready: t.ready, // Metadata ready
      files: t.ready ? t.files.map((f, index) => ({
        name: f.name,
        length: f.length,
        index,
      })) : [],
    }));
    io.emit("torrents:update", updates);
  }, 1000);

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // In production, serve static files from dist
    app.use(express.static(path.join(__dirname, "dist")));
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
