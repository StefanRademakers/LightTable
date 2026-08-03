/*
 * Development-only fixed-corpus encoder for HarfBuzz hb-gpu.
 * HarfBuzz itself retains its upstream license; this adapter is MIT licensed.
 */
#include <hb.h>
#include <hb-gpu.h>

#include <cstdint>
#include <cstdio>
#include <cstdlib>

static bool write_u32(FILE *file, uint32_t value) {
  return std::fwrite(&value, sizeof(value), 1, file) == 1;
}

static bool write_i32(FILE *file, int32_t value) {
  return std::fwrite(&value, sizeof(value), 1, file) == 1;
}

int main(int argc, char **argv) {
  if (argc < 4) {
    std::fprintf(stderr, "Usage: %s FONT OUTPUT GID...\n", argv[0]);
    return 2;
  }
  hb_blob_t *font_blob = hb_blob_create_from_file_or_fail(argv[1]);
  if (!font_blob) return 3;
  hb_face_t *face = hb_face_create(font_blob, 0);
  hb_font_t *font = hb_font_create(face);
  hb_gpu_draw_t *draw = hb_gpu_draw_create_or_fail();
  FILE *output = nullptr;
  if (fopen_s(&output, argv[2], "wb") != 0 || !output || !draw) return 4;
  const uint8_t magic[8] = {'L', 'T', 'H', 'B', 'G', 'P', 'U', 1};
  std::fwrite(magic, sizeof(magic), 1, output);
  write_u32(output, static_cast<uint32_t>(argc - 3));
  for (int index = 3; index < argc; ++index) {
    char *end = nullptr;
    const unsigned long parsed = std::strtoul(argv[index], &end, 10);
    if (!end || *end != '\0' || parsed > UINT32_MAX) return 5;
    const uint32_t glyph_id = static_cast<uint32_t>(parsed);
    hb_gpu_draw_clear(draw);
    if (!hb_gpu_draw_glyph_or_fail(draw, font, glyph_id)) return 6;
    hb_glyph_extents_t extents{};
    hb_blob_t *encoded = hb_gpu_draw_encode(draw, &extents);
    if (!encoded) return 7;
    unsigned length = 0;
    const char *bytes = hb_blob_get_data(encoded, &length);
    if (length > 512 * 1024 || length % 8 != 0) return 8;
    write_u32(output, glyph_id);
    write_u32(output, length);
    write_i32(output, extents.x_bearing);
    write_i32(output, extents.y_bearing);
    write_i32(output, extents.width);
    write_i32(output, extents.height);
    if (length && std::fwrite(bytes, length, 1, output) != 1) return 9;
    hb_blob_destroy(encoded);
  }
  std::fclose(output);
  hb_gpu_draw_destroy(draw);
  hb_font_destroy(font);
  hb_face_destroy(face);
  hb_blob_destroy(font_blob);
  return 0;
}
