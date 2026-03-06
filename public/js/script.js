const eyeIcon = document.querySelector("#eyeIcon");
const pwd = document.querySelector("#pwd");
if (eyeIcon && pwd) {
    eyeIcon.addEventListener("click", () => {
        const isHidden = pwd.type === "password";
        pwd.type = (isHidden) ? "text" : "password";
        eyeIcon.classList.toggle("bi-eye", !isHidden);
        eyeIcon.classList.toggle("bi-eye-slash", isHidden);
    });
}

const eyeIcons = document.querySelectorAll('.iconEye');
eyeIcons.forEach(icon => {
    icon.addEventListener('click', () => {
        const target = icon.dataset.target;
        const pwdField = document.querySelector(target);
        if (pwdField) {
            const isHidden = pwdField.type === "password";
            pwdField.type = (isHidden) ? "text" : "password";
            icon.classList.toggle("bi-eye", !isHidden);
            icon.classList.toggle("bi-eye-slash", isHidden);
        }
    });
});
let currentSong = {};

function closeModal(modalId) {
    const modal = document.querySelector("#" + modalId);
    if (!modal) return;

    modal.style.display = "none";
    if (modalId === "videoModal") {
        const player = document.querySelector("#youtubePlayer");
        if (player) player.src = "";
    }
}

window.onclick = function (event) {
    if (event.target.classList.contains("modal-overlay")) {
        event.target.style.display = "none";
        if (event.target.id === "videoModal") {
            const player = document.querySelector("#youtubePlayer");
            if (player) player.src = "";
        }
    }
}

async function playSong(title) {
    const response = await fetch(`/youtube-search?q=${encodeURIComponent(title)}`);
    if (!response.ok) {
        alert("Could not find a playable video for this track.");
        return;
    }

    const data = await response.json();
    const player = document.querySelector("#youtubePlayer");
    const modal = document.querySelector("#videoModal");
    if (!player || !modal) return;

    player.src = `https://www.youtube.com/embed/${data.videoId}?autoplay=1`;
    modal.style.display = "flex";
}

async function openPlaylistModal(songName, artistName) {
    currentSong = { songName, artistName };
    const modal = document.querySelector("#playlistModal");
    const select = document.querySelector("#playlistSelect");
    const messageBox = document.querySelector("#playlistMessage");
    if (!modal || !select) return;

    if (messageBox) messageBox.textContent = "";

    select.innerHTML = "<option>Loading...</option>";
    modal.style.display = "flex";

    try {
        const response = await fetch("/api/playlists");
        const playlists = await response.json();

        select.innerHTML = "";
        if (playlists.length === 0) {
            select.innerHTML = '<option value="">No playlists found</option>';
            return;
        }
        playlists.forEach(p => {
            let playlistOption = document.createElement('option');
            playlistOption.value = p.playlistId;
            playlistOption.textContent = p.playlistName;
            select.append(playlistOption);
        });
    } catch (error) {
        console.error(error);
        select.innerHTML = '<option>Error loading playlists</option>';
    }
}

async function addToPlaylist() {
    const playlistSelect = document.querySelector("#playlistSelect");
    const messageBox = document.querySelector("#playlistMessage");
    if (!playlistSelect || !messageBox) return;

    const playlistId = playlistSelect.value;

    if (!playlistId) {
        messageBox.style.color = 'red';
        messageBox.textContent = 'Please create a playlist on the profile page first!';
        return;
    }

    try {
        const response = await fetch("/add-to-playlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                playlistId,
                songName: currentSong.songName,
                artistName: currentSong.artistName
            })
        });

        const result = await response.json();

        if (result.success) {
            messageBox.style.color = 'green';
            messageBox.textContent = 'Song added to playlist!';
        } else {
            messageBox.style.color = 'red';
            messageBox.textContent = result.message || 'Failed to add song';
        }
    } catch (error) {
        console.error(error);
        messageBox.style.color = 'red';
        messageBox.textContent = 'Error connecting to server';
    }
}

async function addToFavorites(songName, artistName, btn) {
    const response = await fetch("/add-favorite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songName, artistName })
    });
    const result = await response.json();
    if (result.success) {
        btn.innerHTML = "Added ✅";
        btn.disabled = true;
    } else {
        alert(result.message || "Could not add this song to favorites.");
    }
}
