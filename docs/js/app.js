document.addEventListener('DOMContentLoaded', () => {
    const tocList = document.getElementById('toc-list');
    const sections = document.querySelectorAll('main section');

    sections.forEach(section => {
        const id = section.getAttribute('id');
        const heading = section.querySelector('h2');

        if (id && heading) {
            const listItem = document.createElement('li');
            const link = document.createElement('a');

            link.href = `#${id}`;
            link.textContent = heading.textContent;

            listItem.appendChild(link);
            tocList.appendChild(listItem);
        }
    });
});
