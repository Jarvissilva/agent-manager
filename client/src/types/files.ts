export type FileAttachment = {
  path: string;
  name: string;
  size: number;
  mime: string;
  source: 'reference' | 'upload';
};
export type FileListing = {
  path: string;
  parent: string | null;
  entries: {
    name: string;
    path: string;
    type: 'directory' | 'file';
    size: number;
  }[];
  nextOffset: number | null;
};
