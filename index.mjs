import "dotenv/config";
import express from "express";
import mysql from "mysql2/promise";
import bcrypt from "bcrypt";
import session from "express-session";
import fetch from "node-fetch";

const app = express();
const isProduction = process.env.NODE_ENV === "production";

app.set("trust proxy", 1);
app.use(
    session({
        secret: process.env.SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            sameSite: "lax",
            secure: isProduction,
            maxAge: 1000 * 60 * 60 * 8
        }
    })
);

app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const pool = mysql.createPool({
    host: process.env.HOST,
    user: process.env.USER_DB,
    password: process.env.PASSWORD_DB,
    database: process.env.DATABASE,
    connectionLimit: 10,
    waitForConnections: true
});

const trimString = (value) => (typeof value === "string" ? value.trim() : "");
const isBcryptHash = (value) => typeof value === "string" && value.startsWith("$2");
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const albumArtCache = new Map();

function safeImageUrl(url) {
    if (!url || typeof url !== "string") return null;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
        return parsed.toString();
    } catch {
        return null;
    }
}

async function getAlbumArt(songName, artistName) {
    const track = trimString(songName);
    const artist = trimString(artistName);
    if (!track) return null;

    const cacheKey = `${track.toLowerCase()}::${artist.toLowerCase()}`;
    if (albumArtCache.has(cacheKey)) {
        return albumArtCache.get(cacheKey);
    }

    // First attempt: iTunes Search API (very reliable artwork host).
    try {
        const term = encodeURIComponent(`${artist} ${track}`.trim());
        const url = `https://itunes.apple.com/search?term=${term}&entity=song&limit=1`;
        const response = await fetch(url);
        if (response.ok) {
            const data = await response.json();
            const candidate = data?.results?.[0]?.artworkUrl100 || null;
            const safe = safeImageUrl(candidate);
            if (safe) {
                albumArtCache.set(cacheKey, safe);
                return safe;
            }
        }
    } catch (error) {
        console.error("iTunes artwork fetch failed:", error);
    }

    // Second attempt: Discogs.
    try {
        const key = process.env.DISCOGS_CONSUMER_KEY;
        const secret = process.env.DISCOGS_CONSUMER_SECRET;
        if (key && secret) {
            const endpoint = `https://api.discogs.com/database/search?track=${encodeURIComponent(track)}&artist=${encodeURIComponent(artist)}&type=release&per_page=1`;
            const response = await fetch(endpoint, {
                headers: {
                    Authorization: `Discogs key=${key}, secret=${secret}`,
                    "User-Agent": "PlaylistApp/1.0"
                }
            });
            if (response.ok) {
                const data = await response.json();
                const candidate = data?.results?.[0]?.cover_image || data?.results?.[0]?.thumb || null;
                const safe = safeImageUrl(candidate);
                if (safe) {
                    albumArtCache.set(cacheKey, safe);
                    return safe;
                }
            }
        }
    } catch (error) {
        console.error("Discogs artwork fetch failed:", error);
    }

    albumArtCache.set(cacheKey, null);
    return null;
}

async function fetchProfileData(userId) {
    const [users] = await pool.query(
        `SELECT userId, username, firstName, lastName, email
         FROM login
         WHERE userId = ?`,
        [userId]
    );

    const [favorites] = await pool.query(
        `SELECT songName, artistName
         FROM songs
         WHERE userId = ?
           AND isFavorite = 1`,
        [userId]
    );

    return {
        userInfo: users[0] || null,
        favorites
    };
}

app.get(
    "/profile",
    isUserAuthenticated,
    asyncHandler(async (req, res) => {
        const { userInfo, favorites } = await fetchProfileData(req.session.userId);
        if (!userInfo) {
            req.session.destroy(() => {});
            return res.redirect("/login");
        }

        res.render("profile.ejs", { userInfo, favorites, profileError: null, profileSuccess: null });
    })
);

app.post(
    "/updateProfile",
    isUserAuthenticated,
    asyncHandler(async (req, res) => {
        const firstName = trimString(req.body.firstName);
        const lastName = trimString(req.body.lastName);
        const email = trimString(req.body.email);
        const password = trimString(req.body.password);
        const userId = req.session.userId;

        if (!email || !email.includes("@")) {
            const { userInfo, favorites } = await fetchProfileData(userId);
            return res.status(400).render("profile.ejs", {
                userInfo,
                favorites,
                profileError: "Please provide a valid email address.",
                profileSuccess: null
            });
        }

        if (password && password.length < 8) {
            const { userInfo, favorites } = await fetchProfileData(userId);
            return res.status(400).render("profile.ejs", {
                userInfo,
                favorites,
                profileError: "New password must be at least 8 characters.",
                profileSuccess: null
            });
        }

        const updateValues = [firstName, lastName, email];
        let sql = `UPDATE login
                   SET firstName = ?, lastName = ?, email = ?`;

        if (password) {
            const hashedPassword = await bcrypt.hash(password, 10);
            sql += ", password = ?";
            updateValues.push(hashedPassword);
        }

        sql += " WHERE userId = ?";
        updateValues.push(userId);

        await pool.query(sql, updateValues);
        const { userInfo, favorites } = await fetchProfileData(userId);
        res.render("profile.ejs", {
            userInfo,
            favorites,
            profileError: null,
            profileSuccess: "Profile updated successfully."
        });
    })
);

app.get("/search", isUserAuthenticated, (req, res) => {
    res.render("search.ejs");
});

app.get(
    "/search-test",
    isUserAuthenticated,
    asyncHandler(async (req, res) => {
        const key = process.env.DISCOGS_CONSUMER_KEY;
        const secret = process.env.DISCOGS_CONSUMER_SECRET;
        const songName = trimString(req.query.songName);
        const artistName = trimString(req.query.artistName);

        if (!songName && !artistName) {
            return res.render("results.ejs", { data: [], resultsError: "Enter a song or artist to search." });
        }

        const endpoint = `https://api.discogs.com/database/search?track=${encodeURIComponent(songName)}&artist=${encodeURIComponent(artistName)}&type=release`;
        const response = await fetch(endpoint, {
            headers: {
                Authorization: `Discogs key=${key}, secret=${secret}`,
                "User-Agent": "PlaylistApp/1.0"
            }
        });
        const data = await response.json();

        const uniqueResults = [];
        const seenTitles = new Set();
        for (const result of data.results || []) {
            if (!seenTitles.has(result.title)) {
                seenTitles.add(result.title);
                uniqueResults.push(result);
            }
        }

        res.render("results.ejs", { data: uniqueResults, resultsError: null });
    })
);

app.get("/", isUserAuthenticated, (req, res) => {
    res.render("home.ejs", { name: req.session.username });
});

app.get("/loginTest", isUserAuthenticated, (req, res) => {
    res.render("loginTest.ejs", { name: req.session.username });
});

app.get("/logout", (req, res) => {
    req.session.destroy(() => {
        res.clearCookie("connect.sid");
        res.redirect("/login");
    });
});

app.get("/login", (req, res) => {
    res.render("login.ejs", { loginError: null });
});

app.post(
    "/login",
    asyncHandler(async (req, res) => {
        const username = trimString(req.body.username);
        const password = trimString(req.body.password);

        if (!username || !password) {
            return res.status(400).render("login.ejs", { loginError: "Please enter username and password." });
        }

        const [rows] = await pool.query(
            `SELECT userId, username, password
             FROM login
             WHERE username = ?`,
            [username]
        );

        if (rows.length === 0) {
            return res.status(401).render("login.ejs", { loginError: "Invalid username or password." });
        }

        const user = rows[0];
        let passwordMatches = false;

        if (isBcryptHash(user.password)) {
            passwordMatches = await bcrypt.compare(password, user.password);
        } else {
            passwordMatches = user.password === password;
            if (passwordMatches) {
                const migratedHash = await bcrypt.hash(password, 10);
                await pool.query("UPDATE login SET password = ? WHERE userId = ?", [migratedHash, user.userId]);
            }
        }

        if (!passwordMatches) {
            return res.status(401).render("login.ejs", { loginError: "Invalid username or password." });
        }

        await new Promise((resolve, reject) => {
            req.session.regenerate((error) => {
                if (error) reject(error);
                else resolve();
            });
        });

        req.session.isUserAuthenticated = true;
        req.session.username = user.username;
        req.session.userId = user.userId;
        res.redirect("/");
    })
);

app.post(
    "/add-favorite",
    isUserAuthenticated,
    asyncHandler(async (req, res) => {
        const songName = trimString(req.body.songName);
        const artistName = trimString(req.body.artistName);
        const userId = req.session.userId;

        if (!songName || !artistName) {
            return res.status(400).json({ success: false, message: "Song and artist are required." });
        }

        const sql = `INSERT INTO songs (userId, songName, artistName, isFavorite) VALUES (?, ?, ?, 1)`;
        await pool.query(sql, [userId, songName, artistName]);
        res.json({ success: true });
    })
);

app.get("/register", (req, res) => {
    res.render("register.ejs", { registerError: null, registerSuccess: null });
});

app.post(
    "/register",
    asyncHandler(async (req, res) => {
        const username = trimString(req.body.username);
        const password = trimString(req.body.password);
        const passwordCheck = trimString(req.body.passwordCheck);

        if (!username || !password || !passwordCheck) {
            return res.status(400).render("register.ejs", {
                registerError: "Please fill in all fields.",
                registerSuccess: null
            });
        }

        if (username.length < 3) {
            return res.status(400).render("register.ejs", {
                registerError: "Username must be at least 3 characters.",
                registerSuccess: null
            });
        }

        if (password.length < 8) {
            return res.status(400).render("register.ejs", {
                registerError: "Password must be at least 8 characters.",
                registerSuccess: null
            });
        }

        if (password !== passwordCheck) {
            return res.status(400).render("register.ejs", {
                registerError: "Passwords do not match.",
                registerSuccess: null
            });
        }

        const [existingUsers] = await pool.query("SELECT userId FROM login WHERE username = ?", [username]);
        if (existingUsers.length > 0) {
            return res.status(409).render("register.ejs", {
                registerError: "That username is already taken.",
                registerSuccess: null
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query(`INSERT INTO login (username, password) VALUES (?, ?)`, [username, hashedPassword]);

        res.render("register.ejs", {
            registerError: null,
            registerSuccess: "Account created. You can now sign in."
        });
    })
);

function isUserAuthenticated(req, res, next) {
    if (req.session.isUserAuthenticated) {
        return next();
    }
    res.redirect("/login");
}

app.get(
    "/youtube-search",
    isUserAuthenticated,
    asyncHandler(async (req, res) => {
        const query = trimString(req.query.q);
        const key = process.env.YOUTUBE_API_KEY;

        if (!query) {
            return res.status(400).json({ message: "Missing search query." });
        }

        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&maxResults=1&type=video&key=${key}`;
        const response = await fetch(url);
        const data = await response.json();
        const videoId = data?.items?.[0]?.id?.videoId;

        if (!videoId) {
            return res.status(404).json({ message: "No video found for this track." });
        }

        res.json({ videoId });
    })
);

app.get(
    "/api/playlists",
    isUserAuthenticated,
    asyncHandler(async (req, res) => {
        const [rows] = await pool.query(
            `SELECT playlistId, playlistName
             FROM playlists
             WHERE userId = ?`,
            [req.session.userId]
        );
        res.json(rows);
    })
);

app.post(
    "/add-to-playlist",
    isUserAuthenticated,
    asyncHandler(async (req, res) => {
        const playlistId = Number(req.body.playlistId);
        const songName = trimString(req.body.songName);
        const artistName = trimString(req.body.artistName);
        const userId = req.session.userId;

        if (!playlistId || !songName || !artistName) {
            return res.status(400).json({ success: false, message: "Missing required fields." });
        }

        const sql = `INSERT INTO songs (userId, playlistId, songName, artistName, isFavorite)
                     VALUES (?, ?, ?, ?, 0)`;
        await pool.query(sql, [userId, playlistId, songName, artistName]);
        res.json({ success: true });
    })
);

app.get(
    "/playlists",
    isUserAuthenticated,
    asyncHandler(async (req, res) => {
        const [rows] = await pool.query(
            `SELECT playlistId, playlistName
             FROM playlists
             WHERE userId = ?`,
            [req.session.userId]
        );
        res.render("playlists.ejs", { playlists: rows });
    })
);

app.post(
    "/create-playlist",
    isUserAuthenticated,
    asyncHandler(async (req, res) => {
        const name = trimString(req.body.name);
        if (!name) {
            return res.redirect("/playlists");
        }

        const sql = `INSERT INTO playlists (userId, playlistName) VALUES (?, ?)`;
        await pool.query(sql, [req.session.userId, name]);
        res.redirect("/playlists");
    })
);

app.get(
    "/playlist/:id",
    isUserAuthenticated,
    asyncHandler(async (req, res) => {
        const playlistId = Number(req.params.id);
        if (!playlistId) {
            return res.redirect("/playlists");
        }

        const userId = req.session.userId;
        const [playlist] = await pool.query(
            `SELECT playlistId, playlistName
             FROM playlists
             WHERE playlistId = ?
               AND userId = ?`,
            [playlistId, userId]
        );

        if (playlist.length === 0) {
            return res.redirect("/playlists");
        }

        const [songs] = await pool.query(
            `SELECT songName, artistName
             FROM songs
             WHERE playlistId = ?
               AND userId = ?`,
            [playlistId, userId]
        );

        const songsWithCovers = await Promise.all(
            songs.map(async (song) => {
                const coverUrl = await getAlbumArt(song.songName, song.artistName);
                return { ...song, coverUrl };
            })
        );

        res.render("playlistDetails.ejs", { playlist: playlist[0], songs: songsWithCovers });
    })
);

app.use((error, req, res, next) => {
    console.error("Unhandled error:", error);
    const wantsJson = req.get("accept")?.includes("application/json");
    if (req.originalUrl.startsWith("/api") || wantsJson) {
        return res.status(500).json({ success: false, message: "Something went wrong." });
    }
    res.status(500).send("Something went wrong. Please try again.");
});

app.listen(3000, () => {
    console.log("Express server running");
});