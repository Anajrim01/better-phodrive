export const SECRETS = {
    album: 'albumKeySecret',
    envelope: 'envelopeKeySecret',
    authKey: 'authKeySecret',
    uid: 'uidSecret',
    key: 'capabilitySecret',
    short: 'shortSecret',
    mediaPrefix: 'mediaSecret'
};

export const SHORT_URL = `https://photos.app.goo.gl/${SECRETS.short}`;
export const ALBUM_URL = `https://photos.google.com/share/${SECRETS.uid}?key=${SECRETS.key}`;
