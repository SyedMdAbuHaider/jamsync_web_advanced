document.addEventListener("DOMContentLoaded", async () => {
  const audio = document.getElementById("audioPlayer");
  const playlist = document.getElementById("playlist");

  const res = await fetch("/music");
  const files = await res.json();

  files.forEach((file) => {
    const li = document.createElement("li");
    li.textContent = file;
    li.onclick = () => {
      audio.src = `/music/${file}`;
      audio.play();
    };
    playlist.appendChild(li);
  });

  document.getElementById("uploadForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    await fetch("/upload", { method: "POST", body: form });
    location.reload();
  });
});

