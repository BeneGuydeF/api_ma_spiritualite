const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

/**
 * Exporte une note du carnet en PDF, avec pagination propre + sauts de ligne
 */
async function exportNoteToPDF(note, userId) {

  const exportDir = path.join(__dirname, '..', 'exports', 'journal', String(userId));
  fs.mkdirSync(exportDir, { recursive: true });

  const pdfDoc = await PDFDocument.create();
  const margin = 60;

  const font = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const fontBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);

  const titre = note.titre || 'Note sans titre';
  const createdAt = new Date(note.createdAt || Date.now());
  const dateStr = createdAt.toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });

  const bodyText = (note.contenu || '').replace(/\r\n/g, '\n');

  // Fonction pour créer une nouvelle page
  const newPage = () => {
    const page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    return { page, width, height, cursor: height - margin - 100 };
  };

  let { page, width, height, cursor } = newPage();

  // --- EN-TÊTE ---
  page.drawText(titre, {
    x: margin,
    y: height - margin - 20,
    size: 18,
    font: fontBold,
    color: rgb(0.2, 0.2, 0.2)
  });

  page.drawText(`Créé le ${dateStr}`, {
    x: margin,
    y: height - margin - 45,
    size: 10,
    font,
    color: rgb(0.4, 0.4, 0.4)
  });

  if (note.rubrique) {
    page.drawText(`Rubrique : ${note.rubrique}`, {
      x: margin,
      y: height - margin - 60,
      size: 10,
      font,
      color: rgb(0.4, 0.4, 0.4)
    });
  }

  // --- TEXTE AVEC PAGINATION ---
  const fontSize = 12;
  const lineHeight = fontSize * 1.5;
  const maxWidth = width - margin * 2;

  const paragraphs = bodyText.split(/\n/);

  for (const paragraph of paragraphs) {
    const words = paragraph.split(' ');
    let line = '';

    for (const word of words) {
      const testLine = line + word + ' ';
      const lineWidth = font.widthOfTextAtSize(testLine, fontSize);

      if (lineWidth > maxWidth) {
        // page pleine → nouvelle page
        if (cursor < margin + 40) {
          ({ page, width, height, cursor } = newPage());
        }

        page.drawText(line.trim(), { x: margin, y: cursor, size: fontSize, font });
        cursor -= lineHeight;
        line = word + ' ';
      } else {
        line = testLine;
      }
    }

    if (line.trim() !== '') {
      if (cursor < margin + 40) {
        ({ page, width, height, cursor } = newPage());
      }
      page.drawText(line.trim(), { x: margin, y: cursor, size: fontSize, font });
      cursor -= lineHeight;
    }

    // sauts de ligne entre paragraphes
    cursor -= lineHeight / 2;
  }

  // --- PIED DE PAGE ---
  page.drawText(
    `Ma Spiritualité – Carnet exporté le ${new Date().toLocaleDateString('fr-FR')}`,
    {
      x: margin,
      y: margin - 10,
      size: 9,
      font,
      color: rgb(0.4, 0.4, 0.4)
    }
  );

  // --- SAUVEGARDE ---
  const safeName = titre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .slice(0, 40);

  const fileName = `${safeName || 'note'}_${Date.now()}.pdf`;
  const filePath = path.join(exportDir, fileName);

  fs.writeFileSync(filePath, await pdfDoc.save());
  return filePath;
}

module.exports = { exportNoteToPDF };
