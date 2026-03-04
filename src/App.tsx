import { useEffect, useState, FormEvent } from "react";
import { io } from "socket.io-client";
import { Magnet, Download, Trash2, File, HardDrive, Activity, Clock } from "lucide-react";
import prettyBytes from "pretty-bytes";
import { motion, AnimatePresence } from "motion/react";

const socket = io();

interface TorrentFile {
  name: string;
  length: number;
  index: number;
}

interface Torrent {
  infoHash: string;
  name: string;
  progress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  peers: number;
  timeRemaining: number;
  ready: boolean;
  files: TorrentFile[];
}

export default function App() {
  const [magnetLink, setMagnetLink] = useState("");
  const [torrents, setTorrents] = useState<Torrent[]>([]);
  const [error, setError] = useState("");

  const [isAdding, setIsAdding] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  const fetchTorrents = async () => {
    try {
      const res = await fetch("/api/torrents");
      if (res.ok) {
        const data = await res.json();
        setTorrents(data);
      }
    } catch (err) {
      console.error("Failed to fetch torrents", err);
    }
  };

  useEffect(() => {
    socket.on("connect", () => setIsConnected(true));
    socket.on("disconnect", () => setIsConnected(false));
    
    socket.on("torrents:update", (updatedTorrents: Torrent[]) => {
      setTorrents(updatedTorrents);
    });

    // Initial fetch
    fetchTorrents();

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("torrents:update");
    };
  }, []);

  const handleAddTorrent = async (e: FormEvent) => {
    e.preventDefault();
    if (!magnetLink.trim()) return;

    setIsAdding(true);
    setError("");
    
    try {
      const res = await fetch("/api/torrent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ magnet: magnetLink }),
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || "Failed to add torrent");
      }
      
      setMagnetLink("");
      // Fetch immediately to show pending state if socket is slow
      fetchTorrents();
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to add torrent. Please check the magnet link.");
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveTorrent = async (infoHash: string) => {
    try {
      await fetch(`/api/torrent/${infoHash}`, { method: "DELETE" });
    } catch (err) {
      console.error("Failed to remove torrent", err);
    }
  };

  const formatTime = (ms: number) => {
    if (ms === Infinity || ms === 0) return "--";
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-4 md:p-8 font-sans">
      <div className="max-w-5xl mx-auto space-y-8">
        
        {/* Header */}
        <header className="space-y-2">
          <h1 className="text-3xl md:text-4xl font-bold text-white tracking-tight flex items-center gap-3">
            <Magnet className="w-8 h-8 text-emerald-400" />
            Magnet Streamer
            <div className={`w-3 h-3 rounded-full ml-2 ${isConnected ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" : "bg-red-500"}`} title={isConnected ? "Connected" : "Disconnected"} />
          </h1>
          <p className="text-slate-400">
            Paste a magnet link to start downloading and streaming instantly.
          </p>
        </header>

        {/* Input Section */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 shadow-xl backdrop-blur-sm">
          <form onSubmit={handleAddTorrent} className="flex gap-4 flex-col md:flex-row">
            <input
              type="text"
              value={magnetLink}
              onChange={(e) => setMagnetLink(e.target.value)}
              placeholder="magnet:?xt=urn:btih:..."
              className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 transition-all"
            />
            <button
              type="submit"
              disabled={isAdding}
              className="bg-emerald-500 hover:bg-emerald-400 disabled:bg-emerald-500/50 disabled:cursor-not-allowed text-slate-950 font-semibold px-6 py-3 rounded-xl transition-colors flex items-center justify-center gap-2 min-w-[160px]"
            >
              {isAdding ? (
                <>
                  <Activity className="w-5 h-5 animate-spin" />
                  Adding...
                </>
              ) : (
                <>
                  <Download className="w-5 h-5" />
                  Start Download
                </>
              )}
            </button>
          </form>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mt-4 gap-2">
            <button
              type="button"
              onClick={() => setMagnetLink("magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.empire-js.us%3A1337&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=wss%3A%2F%2Ftracker.btorrent.xyz&tr=wss%3A%2F%2Ftracker.fastcast.nz&tr=wss%3A%2F%2Ftracker.openwebtorrent.com")}
              className="text-xs text-slate-500 hover:text-emerald-400 transition-colors underline cursor-pointer"
            >
              Try with Sintel (Open Source Movie)
            </button>
            {error && <p className="text-red-400 text-sm">{error}</p>}
          </div>
        </div>

        {/* Torrents List */}
        <div className="space-y-6">
          <AnimatePresence>
            {torrents.map((torrent) => (
              <motion.div
                key={torrent.infoHash}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-lg"
              >
                {/* Torrent Header */}
                <div className="p-6 border-b border-slate-800 bg-slate-900/50">
                  <div className="flex justify-between items-start gap-4">
                    <div className="space-y-1 overflow-hidden">
                      <h3 className="text-lg font-semibold text-white truncate" title={torrent.name}>
                        {torrent.name || "Fetching metadata..."}
                      </h3>
                      <div className="flex flex-wrap gap-4 text-xs font-mono text-slate-400">
                        <span className="flex items-center gap-1.5">
                          <HardDrive className="w-3.5 h-3.5" />
                          {(torrent.progress * 100).toFixed(1)}%
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Activity className="w-3.5 h-3.5" />
                          {prettyBytes(torrent.downloadSpeed)}/s
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5" />
                          {formatTime(torrent.timeRemaining)}
                        </span>
                        <span className="text-slate-500">
                          {torrent.peers} peers
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveTorrent(torrent.infoHash)}
                      className="text-slate-500 hover:text-red-400 transition-colors p-2 hover:bg-red-400/10 rounded-lg"
                      title="Remove Torrent"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Progress Bar */}
                  <div className="mt-4 h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-500 ease-out"
                      style={{ width: `${torrent.progress * 100}%` }}
                    />
                  </div>
                </div>

                {/* Files List */}
                {torrent.ready && (
                  <div className="bg-slate-950/30 max-h-64 overflow-y-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-900/80 text-slate-500 font-medium sticky top-0 backdrop-blur-sm">
                        <tr>
                          <th className="px-6 py-3">File Name</th>
                          <th className="px-6 py-3 text-right">Size</th>
                          <th className="px-6 py-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/50">
                        {torrent.files.map((file) => (
                          <tr key={file.index} className="hover:bg-slate-800/30 transition-colors">
                            <td className="px-6 py-3 text-slate-300 truncate max-w-xs md:max-w-md">
                              <div className="flex items-center gap-2">
                                <File className="w-4 h-4 text-slate-500 flex-shrink-0" />
                                <span className="truncate" title={file.name}>{file.name}</span>
                              </div>
                            </td>
                            <td className="px-6 py-3 text-right text-slate-400 font-mono text-xs">
                              {prettyBytes(file.length)}
                            </td>
                            <td className="px-6 py-3 text-right">
                              <a
                                href={`/api/stream/${torrent.infoHash}/${file.index}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-emerald-400 hover:text-emerald-300 text-xs font-medium px-3 py-1.5 bg-emerald-400/10 hover:bg-emerald-400/20 rounded-full transition-colors"
                              >
                                <Download className="w-3 h-3" />
                                Download
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {torrents.length === 0 && (
            <div className="text-center py-20 text-slate-600 border-2 border-dashed border-slate-800 rounded-2xl">
              <Magnet className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">No active downloads</p>
              <p className="text-sm">Add a magnet link above to get started</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
