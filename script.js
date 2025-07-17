
const musicUpload = document.getElementById('musicUpload');
const musicList = document.getElementById('musicList');
const audioPlayer = document.getElementById('audioPlayer');

musicUpload.addEventListener('change', (event) => {
    const files = Array.from(event.target.files);
    musicList.innerHTML = '';

    files.forEach(file => {
        const listItem = document.createElement('li');
        listItem.textContent = file.name;
        listItem.addEventListener('click', () => {
            audioPlayer.src = URL.createObjectURL(file);
            audioPlayer.play();
        });
        musicList.appendChild(listItem);
    });
});
