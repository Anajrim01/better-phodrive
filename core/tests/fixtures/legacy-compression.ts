/**
 * Frozen legacy compressed chunks generated from the fork at
 * f1206ffed73d259bbbc06c29f2618bc79f0defbf with Node 24.11.1 and its bundled Brotli
 * (quality 1, size hint = original size). The literals below are the expected bytes; tests must
 * not rebuild them with the current encoder.
 */
const FIXTURE_TOTAL = 196_662;

export const LEGACY_ROOT_V1 = {
    totalSize: FIXTURE_TOTAL,
    prefixHex:
        '424d36000300000000003600000028000000000100000001000001001800000000000000030000000000000000000000000000000000424d53504c495401b78dd38e84d5e3f2845269416246cfdda348f7d0b5dafe6f3f80d6f8741d45d6e40b173082468dd6b4903bd3eadfc6d47bbf6dde7d86d141a97882e997dbc00b00033e80400a6c65676163792e747874',
    payloadHex:
        '8bff0f0080aaaaaaeaffae9713ebf9b8b1aa0a8000888280a8822a1cc0c5af149f220f1b8c794694f7b2ee7209e52ceda3ba850a86bc38ce9c9e312f000c',
    text: 'phodrive legacy brotli fixture!\n',
    repeats: 256,
    fileHash: 'b78dd38e84d5e3f2845269416246cfdda348f7d0b5dafe6f3f80d6f8741d45d6',
    fileId: 'e40b173082468dd6b4903bd3eadfc6d47bbf6dde7d86d141a97882e997dbc00b',
    fileName: 'legacy.txt',
    flags: 3,
    payloadSize: 62,
    originalSize: 8_192,
    sha1: 'b58de5d8f950053a2fa7d437aa6cf2d959f744e6',
    bmpSha256: '63fd564b67f6f6d2cd1d5045035087a3b57c07410c3f8e7ae979ea292fd31170'
} as const;

export const LEGACY_FOLDER_V2 = {
    totalSize: FIXTURE_TOTAL,
    prefixHex:
        '424d36000300000000003600000028000000000100000001000001001800000000000000030000000000000000000000000000000000424d53504c495402202cfd54a83fc44c7fc6d2e7d70abe8c515eee02329894b74adece3a7ea300ebec8574e6c187f82f43f68f2595c9afb620172528e8955050d5f3de64f8e03a2300024080200a7265706f72742e62696e0d50726f6a656374732f32303236',
    payloadHex:
        '8bff070080aaaaaaeaffae97131fce7abc89aa882a280003b082808202081cc0c5af149f220f1b8c79469497e891f81d8c6db330528f07d78a326fcf98070006',
    text: 'folder v2 legacy brotli payload\n',
    repeats: 128,
    fileHash: '202cfd54a83fc44c7fc6d2e7d70abe8c515eee02329894b74adece3a7ea300eb',
    fileId: 'ec8574e6c187f82f43f68f2595c9afb620172528e8955050d5f3de64f8e03a23',
    fileName: 'report.bin',
    folder: 'Projects/2026',
    flags: 2,
    payloadSize: 64,
    originalSize: 4_096,
    sha1: '5c926bf7c7789ad4370167c445fb16900d047c28',
    bmpSha256: '6e7573a3f672dfa1200ced70b815da93043144e486b00e667313873df80bb726'
} as const;

export const LEGACY_FOLDER_V2_TAIL = {
    totalSize: FIXTURE_TOTAL,
    prefixHex:
        '424d36000300000000003600000028000000000100000001000001001800000000000000030000000000000000000000000000000000424d53504c495401202cfd54a83fc44c7fc6d2e7d70abe8c515eee02329894b74adece3a7ea300ebec8574e6c187f82f43f68f2595c9afb620172528e8955050d5f3de64f8e03a23010112',
    payloadHex: '6c6567616379207461696c206368756e6b0a',
    text: 'legacy tail chunk\n',
    repeats: 1,
    flags: 1,
    payloadSize: 18,
    sha1: '566f0985c8c50a651a9477d054ef1158a66fc16b',
    bmpSha256: 'b317a7e6e60e4eb907f991c2ed3b3b20307301ea696ac28de592e02786ec3dc6'
} as const;

type Fixture = {
    totalSize: number;
    prefixHex: string;
    payloadHex: string;
    text: string;
    repeats: number;
};

export function fixtureBmp(fixture: Fixture): Buffer {
    const prefix = Buffer.from(fixture.prefixHex, 'hex');
    const payload = Buffer.from(fixture.payloadHex, 'hex');

    return Buffer.concat([
        prefix,
        payload,
        Buffer.alloc(fixture.totalSize - prefix.length - payload.length)
    ]);
}

export function fixtureContent(fixture: Fixture): Buffer {
    return Buffer.from(fixture.text.repeat(fixture.repeats));
}
