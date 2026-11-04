/**
 * QR de matriculación TOTP (D-07, ADR-0039): data URL SVG de la URI
 * `otpauth://` para que la app de autenticación la lea de la cámara.
 *
 * `qrcode` es la única dependencia añadida por la 2FA (justificada en
 * ADR-0039): generación SERVER-side (la URI contiene el secreto: nunca debe
 * salir a un servicio externo), sin JavaScript de cliente nuevo.
 *
 * Se devuelve como data URL (`data:image/svg+xml;utf8,…`): el QR es
 * autosoportado (no depende de rutas de la app ni de CDN) y viaja como
 * cualquier otra respuesta de la API.
 */
import QRCode from "qrcode";

export async function toTotpQrDataUrl(otpauthUri: string): Promise<string> {
  const svg = await QRCode.toString(otpauthUri, {
    type: "svg",
    margin: 1,
    width: 256,
    errorCorrectionLevel: "M",
  });
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
