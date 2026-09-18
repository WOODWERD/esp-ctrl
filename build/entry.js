export { ESPLoader, Transport } from "esptool-js";
import SparkMD5 from "spark-md5";
export const md5 = (u8) => SparkMD5.ArrayBuffer.hash(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
