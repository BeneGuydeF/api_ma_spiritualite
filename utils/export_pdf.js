// utils/export_pdf.js
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

/**
 * Exporte une note du carnet en PDF élégant.
 * @param {Object} note - { titre, contenu, rubrique, createdAt, updatedAt }
 * @param {number} userId - identifiant utilisateur pour ranger dans un dossier perso
 * @returns {string} chemin absolu du PDF généré
 */
async function exportNoteToPDF(note, userId) {
  const exportDir = path.join(__dirname, '..', 'exports', 'journal', String(userId));
  fs.mkdirSync(exportDir, { recursive: true });

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage();
  const { width, height } = page.getSize();

  const margin = 60;
  const font = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const fontBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);

  // En-tête
  const titre = note.titre || 'Note sans titre';
  const date = new Date(note.createdAt || Date.now()).toLocaleString('fr-FR', {
    dateStyle: 'long', timeStyle: 'short'
  });

  page.drawText(titre, {
    x: margin, y: height - margin - 20,
    size: 18, font: fontBold, color: rgb(0.2, 0.2, 0.2)
  });

  page.drawText(`Créé le ${date}`, {
    x: margin, y: height - margin - 45,
    size: 10, font, color: rgb(0.4, 0.4, 0.4)
  });

  if (note.rubrique) {
    page.drawText(`Rubrique : ${note.rubrique}`, {
      x: margin, y: height - margin - 60,
      size: 10, font, color: rgb(0.4, 0.4, 0.4)
    });
  }

  // Corps de texte
  const text = note.contenu || '';
  const fontSize = 12;
  const lineHeight = fontSize * 1.5;
  const textWidth = width - 2 * margin;

  const words = text.split(/\s+/);
  let line = '';
  let y = height - margin - 100;

  for (const word of words) {
    const testLine = line + word + ' ';
    const lineWidth = font.widthOfTextAtSize(testLine, fontSize);
    if (lineWidth > textWidth) {
      page.drawText(line.trim(), { x: margin, y, size: fontSize, font, color: rgb(0, 0, 0) });
      line = word + ' ';
      y -= lineHeight;
      if (y < margin + 50) break;
    } else {
      line = testLine;
    }
  }
  if (line) page.drawText(line.trim(), { x: margin, y, size: fontSize, font });

  // Pied de page
  const footer = `Ma Spiritualité – Carnet chiffré exporté le ${new Date().toLocaleDateString('fr-FR')}`;
  page.drawText(footer, {
    x: margin, y: margin - 10,
    size: 9, font, color: rgb(0.4, 0.4, 0.4)
  });

  const pdfBytes = await pdfDoc.save();
  const fileName = `${titre.replace(/[^\w\s-]/g, '').slice(0, 40).trim() || 'note'}_${Date.now()}.pdf`;
  const filePath = path.join(exportDir, fileName);

  fs.writeFileSync(filePath, pdfBytes);
  return filePath;
}

module.exports = { exportNoteToPDF };
