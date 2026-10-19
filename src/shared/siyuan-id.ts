export function generateSiYuanNodeId(now = new Date()): string {
    const pad = (value: number, length = 2) => String(value).padStart(length, '0');
    const timestamp = [
        now.getFullYear(),
        pad(now.getMonth() + 1),
        pad(now.getDate()),
        pad(now.getHours()),
        pad(now.getMinutes()),
        pad(now.getSeconds()),
    ].join('');
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let suffix = '';
    for (let index = 0; index < 7; index += 1) {
        suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return `${timestamp}-${suffix}`;
}
