export type Row = {
  /** Sub-barcode (cột B), duy nhất, dùng làm id và tên file */
  id: string;
  /** link ảnh design (cột I) */
  url: string;
  /** Product Type (cột F) */
  productType: string;
  /** Variant (cột E) */
  variant: string;
};

export type Status = "check" | "ready" | "exported";

export type Offset = {
  dx: number;
  dy: number;
};

/** Key ô dạng "c,r" (c = cột ngang, r = hàng dọc, bắt đầu từ 1) */
export type CellOffsets = Record<string, Offset>;

/** SKU -> offset từng ô (theo id = Sub-barcode) */
export type AlignmentMap = Record<string, CellOffsets>;

export type ProductType = {
  cols: number;
  rows: number;
  /** mỗi nhóm là danh sách ô [c, r] sẽ được cắt và đặt trùng tâm nhau */
  groups: [number, number][][];
};

/** Thông tin đặt cho từng ô: tên và màu hiển thị (mã hex, ví dụ #dc2626) */
export type CellInfo = {
  name?: string;
  color?: string;
  /** in ngược: lật ngang cả ô */
  mirror?: boolean;
};

/** Một khai báo: Product Type + mẫu Variant (có thể dùng *) và cách chia ô */
export type ProductRule = ProductType & {
  /** tên hiển thị trong app */
  name: string;
  productType: string;
  /** mẫu Variant, ví dụ "ONE SIDE", "*\/ONE SIDE", "ONE SIDE\/*" */
  variant: string;
  /** tên và màu của từng ô, key "c,r" */
  cells?: Record<string, CellInfo>;
};

export type ProductConfig = ProductRule[];

/**
 * Bố cục riêng của một ảnh (khi ảnh thật khác khai báo, ví dụ khai báo 1×3 nhưng ảnh 1×2).
 * - cols, rows: lưới thật của ảnh này.
 * - map: ô của khai báo "c,r" -> ô của ảnh "c,r" sẽ được cắt cho ô đó.
 * Nhóm vẫn lấy theo khai báo gốc.
 */
export type LayoutOverride = {
  cols: number;
  rows: number;
  map: Record<string, string>;
};

/** Bản ghi lưu trong JSON server (collection "records") */
export type DbRecord = {
  /** Sub-barcode (cột B) */
  id: string;
  /** thứ tự import, tăng dần theo dòng trong file */
  seq: number;
  /** thời điểm import */
  batch: string;
  /** số dòng trong file Excel gốc */
  row: number;
  /** toàn bộ giá trị các cột của dòng gốc, để xuất lại đúng định dạng */
  raw: unknown[];
  sku: string;
  variant: string;
  productType: string;
  url: string;
  status: Status;
  offsets: CellOffsets;
  /** bố cục riêng của ảnh này; không có thì dùng khai báo gốc */
  layout?: LayoutOverride | null;
  updatedAt: string;
};

/** Thông tin file Excel gốc (collection "meta") */
export type DbMeta = {
  headers: string[];
  sheetName: string;
};

/** Một lần xuất xlsx, lưu làm lịch sử (collection "exports") */
export type ExportRecord = {
  id: string;
  createdAt: string;
  /** tên file đã tải (ví dụ 12_Custom_..._18_11_K7Q2MB.xlsx) */
  fileName: string;
  /** đường dẫn file đã lưu trên máy chủ */
  filePath: string;
  /** khai báo hoặc Product Type đã xuất, hoặc "Tất cả" */
  label: string;
  /** trạng thái đã lọc: check / ready / exported, hoặc "tất cả" */
  status: string;
  count: number;
  /** Sub-barcode của các item có trong file */
  skus: string[];
};
