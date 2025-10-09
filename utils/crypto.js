// utils/crypto.js - Utilitaires de chiffrement pour le carnet spirituel
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const TAG_LENGTH = 16;

/**
 * Génère un salt aléatoire pour l'utilisateur
 */
function generateSalt() {
  return crypto.randomBytes(SALT_LENGTH).toString('hex');
}

/**
 * Dérive une clé de chiffrement à partir du mot de passe et du salt
 */
function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, Buffer.from(salt, 'hex'), 100000, 32, 'sha512');
}

/**
 * Chiffre un texte avec AES-256-GCM
 * @param {string} plaintext - Texte à chiffrer
 * @param {string} password - Mot de passe utilisateur
 * @param {string} salt - Salt de l'utilisateur
 * @returns {object} - {encryptedData, iv, tag}
 */
function encrypt(plaintext, password, salt) {
  const key = deriveKey(password, salt);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipher(ALGORITHM, key);
  cipher.setAAD(Buffer.from('ma_spiritualite'));
  
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const tag = cipher.getAuthTag();
  
  return {
    encryptedData: encrypted,
    iv: iv.toString('hex'),
    tag: tag.toString('hex')
  };
}

/**
 * Déchiffre un texte avec AES-256-GCM
 * @param {string} encryptedData - Données chiffrées
 * @param {string} iv - Vecteur d'initialisation
 * @param {string} tag - Tag d'authentification
 * @param {string} password - Mot de passe utilisateur
 * @param {string} salt - Salt de l'utilisateur
 * @returns {string} - Texte déchiffré
 */
function decrypt(encryptedData, iv, tag, password, salt) {
  try {
    const key = deriveKey(password, salt);
    const decipher = crypto.createDecipher(ALGORITHM, key);
    decipher.setAAD(Buffer.from('ma_spiritualite'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    throw new Error('Déchiffrement échoué: mot de passe incorrect ou données corrompues');
  }
}

/**
 * Chiffre un objet JSON
 */
function encryptJSON(obj, password, salt) {
  const jsonString = JSON.stringify(obj);
  return encrypt(jsonString, password, salt);
}

/**
 * Déchiffre vers un objet JSON
 */
function decryptJSON(encryptedData, iv, tag, password, salt) {
  const decrypted = decrypt(encryptedData, iv, tag, password, salt);
  return JSON.parse(decrypted);
}

/**
 * Génère un hash sécurisé pour vérification d'intégrité
 */
function generateHash(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Vérifie l'intégrité des données
 */
function verifyHash(data, hash) {
  return generateHash(data) === hash;
}

module.exports = {
  generateSalt,
  deriveKey,
  encrypt,
  decrypt,
  encryptJSON,
  decryptJSON,
  generateHash,
  verifyHash,
  ALGORITHM,
  IV_LENGTH,
  SALT_LENGTH,
  TAG_LENGTH
};