import { Modal, Result, List, Typography } from 'antd';
import type { ImportResult } from '../types';

interface Props {
  result: ImportResult | null;
  onClose: () => void;
  title?: string;
}

export default function ImportResultModal({ result, onClose, title = '导入结果' }: Props) {
  return (
    <Modal open={Boolean(result)} onCancel={onClose} footer={null} title={title}>
      {result && (
        <>
          <Result
            status={result.errors.length > 0 && result.imported === 0 ? 'warning' : 'success'}
            title={`成功导入 ${result.imported} 条，跳过 ${result.skipped} 条`}
            subTitle={result.errors.length > 0 ? `有 ${result.errors.length} 行导入失败` : undefined}
          />
          {result.errors.length > 0 && (
            <>
              <Typography.Text strong>失败明细：</Typography.Text>
              <List
                size="small"
                dataSource={result.errors}
                renderItem={(e) => (
                  <List.Item>
                    {e.row ? `第 ${e.row} 行：` : ''}
                    {e.message}
                  </List.Item>
                )}
                style={{ maxHeight: 200, overflow: 'auto' }}
              />
            </>
          )}
        </>
      )}
    </Modal>
  );
}
