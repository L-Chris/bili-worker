/**
 * B站 av 号和 bv 号互转工具
 * 代码来源：https://www.zhihu.com/question/381784377/answer/1099438784
 * 此部分代码以 WTFPL 开源
 */

const XOR_CODE = 23442827791579n;
const MASK_CODE = 2251799813685247n;
const MAX_AID = 1n << 51n;

const data = [
  "F", "c", "w", "A", "P", "N", "K", "T", "M", "u",
  "g", "3", "G", "V", "5", "L", "j", "7", "E", "J",
  "n", "H", "p", "W", "s", "x", "4", "t", "b", "8",
  "h", "a", "Y", "e", "v", "i", "q", "B", "z", "6",
  "r", "k", "C", "y", "1", "2", "m", "U", "S", "D",
  "Q", "X", "9", "R", "d", "o", "Z", "f"
];

const BASE = 58;
const BV_LEN = 12;
const PREFIX = "BV1";

/**
 * BV 号转 AV 号
 * @param bvid BV号
 * @returns AV号
 */
export function bvid2aid(bvid: string): number {
  const bvidArr = bvid.split("");
  // 交换位置
  [bvidArr[3], bvidArr[9]] = [bvidArr[9], bvidArr[3]];
  [bvidArr[4], bvidArr[7]] = [bvidArr[7], bvidArr[4]];
  
  const encodedBv = bvidArr.slice(3);
  let tmp = 0n;
  
  for (const char of encodedBv) {
    const idx = data.indexOf(char);
    tmp = tmp * BigInt(BASE) + BigInt(idx);
  }
  
  return Number((tmp & MASK_CODE) ^ XOR_CODE);
}

/**
 * AV 号转 BV 号
 * @param aid AV号
 * @returns BV号
 */
export function aid2bvid(aid: number): string {
  const bytes = ["B", "V", "1", "0", "0", "0", "0", "0", "0", "0", "0", "0"];
  let bvIdx = BV_LEN - 1;
  let tmp = (MAX_AID | BigInt(aid)) ^ XOR_CODE;
  
  while (tmp !== 0n) {
    bytes[bvIdx] = data[Number(tmp % BigInt(BASE))];
    tmp = tmp / BigInt(BASE);
    bvIdx--;
  }
  
  // 交换位置
  [bytes[3], bytes[9]] = [bytes[9], bytes[3]];
  [bytes[4], bytes[7]] = [bytes[7], bytes[4]];
  
  return bytes.join("");
}

export const formatTimestamp = (timestamp: number, showHours: boolean = false) => {
  const time = timestamp  === 0 ? 0 : timestamp - (timestamp === timestamp ? 0.01 : 0);
  const hours = Math.floor(time / 3600).toString().padStart(2, '0');
  const minutes = Math.floor(time / 60 % 60).toString().padStart(2, '0');
  const seconds = Math.floor(time % 60).toString().padStart(2, '0');
  return showHours ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`;
};
