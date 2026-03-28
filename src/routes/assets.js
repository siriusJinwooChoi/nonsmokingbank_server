import { Router } from "express";
import fs from "fs";
import path from "path";

const imageExt = /\.(png|jpg|jpeg|webp)$/i;

/**
 * @param {string} assetsRoot - express.static 과 동일한 루트 (예: public/app-assets)
 */
export function createAssetsManifestRouter(assetsRoot) {
  const router = Router();

  /** 담배갑 PNG/JPG 목록 — 앱이 원격 도감·게임에 사용 */
  router.get("/cigarettes", (req, res) => {
    const dir = path.join(assetsRoot, "cigarettes");
    try {
      if (!fs.existsSync(dir)) {
        return res.status(200).json({ ok: true, items: [] });
      }
      const names = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isFile() && imageExt.test(d.name))
        .map((d) => `cigarettes/${d.name}`)
        .sort();
      return res.status(200).json({ ok: true, items: names });
    } catch (err) {
      console.error("[assets/cigarettes]", err);
      return res.status(500).json({
        error: "ASSETS_LIST_FAILED",
        message: "Could not list cigarette pack images",
      });
    }
  });

  return router;
}
