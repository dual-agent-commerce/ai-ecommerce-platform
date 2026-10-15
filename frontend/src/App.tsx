
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";

type Product = {
  id: number;
  name: string;
  cost: number;
  current_price: number;
  inventory: number;
  category?: string | null;
  brand?: string | null;
  specifications?: Record<string, unknown>;
};

type WorkflowResult = {
  product_id: number;
  pricing_result: {
    product_id: number;
    suggested_price: number;
    method: string;
    confidence: number;
  };
  listing_result: {
    status: string;
    listing_id: string;
    error_message: string;
  };
};

const API_URL = "http://127.0.0.1:8000";

const formatMoney = (value: number) =>
  `NT$${value.toLocaleString("zh-TW")}`;

function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 新增商品
  const [name, setName] = useState("");
  const [cost, setCost] = useState("");
  const [currentPrice, setCurrentPrice] = useState("");
  const [inventory, setInventory] = useState("");
  const [category, setCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [specifications, setSpecifications] = useState("{}");

  // 修改價格
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingPrice, setEditingPrice] = useState("");

  // AI Workflow
  const [selectedProductId, setSelectedProductId] = useState("");
  const [workflowResult, setWorkflowResult] =
    useState<WorkflowResult | null>(null);
  const [isRunningWorkflow, setIsRunningWorkflow] = useState(false);

  const totalInventory = products.reduce(
    (total, product) => total + product.inventory,
    0
  );

  const selectedProduct = products.find(
    (product) => product.id === Number(selectedProductId)
  );

  async function fetchProducts() {
    try {
      const response = await fetch(`${API_URL}/products`);

      if (!response.ok) {
        throw new Error("Failed to fetch products");
      }

      const data: Product[] = await response.json();
      setProducts(data);
      return true;
    } catch {
      setError("無法取得商品資料，請確認 Backend 是否啟動");
      return false;
    }
  }

  useEffect(() => {
    void fetchProducts();
  }, []);

  async function handleAddProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (
      !name.trim() ||
      cost.trim() === "" ||
      currentPrice.trim() === "" ||
      inventory.trim() === ""
    ) {
      setError("請填寫商品名稱、成本、售價和庫存");
      return;
    }

    const values = [
      Number(cost),
      Number(currentPrice),
      Number(inventory),
    ];

    if (
      values.some(
        (value) => !Number.isSafeInteger(value) || value < 0
      )
    ) {
      setError("成本、售價和庫存必須是非負整數");
      return;
    }

    let parsedSpecifications: Record<string, unknown>;

    try {
      const parsed: unknown = JSON.parse(specifications);

      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        throw new Error("Specifications must be an object");
      }

      parsedSpecifications = parsed as Record<string, unknown>;
    } catch {
      setError('商品規格必須是合法的 JSON 物件，例如 {"ram":"16 GB"}');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_URL}/products`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: name.trim(),
          cost: Number(cost),
          current_price: Number(currentPrice),
          inventory: Number(inventory),
          category: category.trim() || null,
          brand: brand.trim() || null,
          specifications: parsedSpecifications,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to create product");
      }

      const newProduct: Product = await response.json();

      setProducts((previous) => [...previous, newProduct]);

      setName("");
      setCost("");
      setCurrentPrice("");
      setInventory("");
      setCategory("");
      setBrand("");
      setSpecifications("{}");

      setMessage(`成功新增商品：${newProduct.name}`);
    } catch {
      setError("新增商品失敗，請確認 Backend 與資料庫是否正常");
    } finally {
      setIsSubmitting(false);
    }
  }

  function startEditing(product: Product) {
    setEditingId(product.id);
    setEditingPrice(String(product.current_price));
    setError("");
    setMessage("");
  }

  async function handleUpdatePrice(productId: number) {
    setError("");
    setMessage("");

    const price = Number(editingPrice);

    if (
      editingPrice.trim() === "" ||
      !Number.isSafeInteger(price) ||
      price < 0
    ) {
      setError("售價必須是非負整數");
      return;
    }

    try {
      const response = await fetch(
        `${API_URL}/products/${productId}/price`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            current_price: price,
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to update price");
      }

      const refreshed = await fetchProducts();

      if (!refreshed) return;

      setEditingId(null);
      setEditingPrice("");
      setWorkflowResult(null);
      setMessage("商品售價修改成功");
    } catch {
      setError("修改售價失敗");
    }
  }

  async function handleDeleteProduct(productId: number) {
    if (!window.confirm("確定要刪除這個商品嗎？")) {
      return;
    }

    setError("");
    setMessage("");

    try {
      const response = await fetch(
        `${API_URL}/products/${productId}`,
        { method: "DELETE" }
      );

      if (!response.ok) {
        throw new Error("Failed to delete product");
      }

      const refreshed = await fetchProducts();

      if (!refreshed) return;

      if (editingId === productId) {
        setEditingId(null);
        setEditingPrice("");
      }

      if (selectedProductId === String(productId)) {
        setSelectedProductId("");
        setWorkflowResult(null);
      }

      setMessage("商品刪除成功");
    } catch {
      setError(
        "刪除商品失敗。如果商品已有銷售歷史，可能受到資料庫外鍵限制"
      );
    }
  }

  async function handleRunWorkflow() {
    if (!selectedProductId) {
      setError("請先選擇商品");
      return;
    }

    setError("");
    setMessage("");
    setWorkflowResult(null);
    setIsRunningWorkflow(true);

    try {
      const response = await fetch(
        `${API_URL}/workflow/${selectedProductId}`,
        { method: "POST" }
      );

      if (!response.ok) {
        throw new Error("Workflow failed");
      }

      const result: WorkflowResult = await response.json();

      setWorkflowResult(result);
      setMessage("Mock Workflow 執行完成");
    } catch {
      setError(
        "Workflow 執行失敗，請確認 Backend 的 /workflow API"
      );
    } finally {
      setIsRunningWorkflow(false);
    }
  }

  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <div>
          <h1>AI E-commerce Platform</h1>
        </div>
        <span className="demo-badge">Mock Demo</span>
      </header>

      <div className="stats-grid">
        <div className="stat-card">
          <span>Products</span>
          <strong>{products.length}</strong>
        </div>

        <div className="stat-card">
          <span>Total Inventory</span>
          <strong>{totalInventory}</strong>
        </div>

        <div className="stat-card">
          <span>Agent Integration</span>
          <strong>Mock</strong>
        </div>
      </div>

      {message && (
        <div className="alert alert-success">{message}</div>
      )}

      {error && (
        <div className="alert alert-error">{error}</div>
      )}

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Add Product</h2>
            <p>新增商品資料至 PostgreSQL</p>
          </div>
        </div>

        <form
          className="product-form"
          onSubmit={handleAddProduct}
        >
          <label>
            商品名稱 *
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如 RTX 5070"
              required
            />
          </label>

          <label>
            分類
            <input
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              placeholder="例如 Graphics Card"
            />
          </label>

          <label>
            品牌
            <input
              value={brand}
              onChange={(event) => setBrand(event.target.value)}
              placeholder="例如 ASUS"
            />
          </label>

          <label>
            進貨成本 *
            <input
              type="number"
              min="0"
              step="1"
              value={cost}
              onChange={(event) => setCost(event.target.value)}
              placeholder="NTD"
              required
            />
          </label>

          <label>
            目前售價 *
            <input
              type="number"
              min="0"
              step="1"
              value={currentPrice}
              onChange={(event) =>
                setCurrentPrice(event.target.value)
              }
              placeholder="NTD"
              required
            />
          </label>

          <label>
            庫存 *
            <input
              type="number"
              min="0"
              step="1"
              value={inventory}
              onChange={(event) => setInventory(event.target.value)}
              placeholder="數量"
              required
            />
          </label>

          <label className="full-width">
            商品規格（JSON）
            <textarea
              rows={3}
              value={specifications}
              onChange={(event) =>
                setSpecifications(event.target.value)
              }
              placeholder='{"ram":"16 GB","storage":"512 GB SSD"}'
            />
          </label>

          <div className="full-width">
            <button
              className="primary-button"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? "新增中..." : "新增商品"}
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Product Management</h2>
            <p>檢視商品、修改價格與刪除商品</p>
          </div>

          <button
            className="secondary-button"
            onClick={() => void fetchProducts()}
          >
            重新整理
          </button>
        </div>

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>商品名稱</th>
                <th>分類 / 品牌</th>
                <th>成本</th>
                <th>目前售價</th>
                <th>庫存</th>
                <th>操作</th>
              </tr>
            </thead>

            <tbody>
              {products.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-state">
                    目前沒有商品資料
                  </td>
                </tr>
              ) : (
                products.map((product) => (
                  <tr key={product.id}>
                    <td>{product.id}</td>

                    <td>
                      <strong>{product.name}</strong>
                      {product.specifications &&
                        Object.keys(product.specifications).length > 0 && (
                          <details className="spec-details">
                            <summary>查看規格</summary>
                            <pre>
                              {JSON.stringify(
                                product.specifications,
                                null,
                                2
                              )}
                            </pre>
                          </details>
                        )}
                    </td>

                    <td>
                      {product.category || "—"}
                      <br />
                      <span className="muted">
                        {product.brand || "—"}
                      </span>
                    </td>

                    <td>{formatMoney(product.cost)}</td>

                    <td>
                      {editingId === product.id ? (
                        <input
                          className="price-input"
                          type="number"
                          min="0"
                          step="1"
                          value={editingPrice}
                          onChange={(event) =>
                            setEditingPrice(event.target.value)
                          }
                        />
                      ) : (
                        formatMoney(product.current_price)
                      )}
                    </td>

                    <td>{product.inventory}</td>

                    <td>
                      <div className="action-buttons">
                        {editingId === product.id ? (
                          <>
                            <button
                              className="primary-button"
                              onClick={() =>
                                void handleUpdatePrice(product.id)
                              }
                            >
                              儲存
                            </button>

                            <button
                              className="secondary-button"
                              onClick={() => setEditingId(null)}
                            >
                              取消
                            </button>
                          </>
                        ) : (
                          <button
                            className="secondary-button"
                            onClick={() => startEditing(product)}
                          >
                            修改價格
                          </button>
                        )}

                        <button
                          className="danger-button"
                          onClick={() =>
                            void handleDeleteProduct(product.id)
                          }
                        >
                          刪除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>AI Pricing & Listing</h2>
            <p>
              Backend → Mock Agent 1 → Backend → Mock Agent 2
            </p>
          </div>
          <span className="demo-badge">Simulation</span>
        </div>

        <div className="workflow-controls">
          <label>
            選擇商品
            <select
              value={selectedProductId}
              onChange={(event) => {
                setSelectedProductId(event.target.value);
                setWorkflowResult(null);
              }}
            >
              <option value="">請選擇商品</option>

              {products.map((product) => (
                <option
                  key={product.id}
                  value={product.id}
                >
                  {product.name} — {formatMoney(product.current_price)}
                </option>
              ))}
            </select>
          </label>

          <button
            className="primary-button"
            onClick={() => void handleRunWorkflow()}
            disabled={isRunningWorkflow || !selectedProductId}
          >
            {isRunningWorkflow
              ? "Workflow 執行中..."
              : "Run AI Workflow"}
          </button>
        </div>

        {selectedProduct && (
          <div className="selected-product">
            <span>Selected Product</span>
            <strong>{selectedProduct.name}</strong>
            <span>
              Current Price:{" "}
              {formatMoney(selectedProduct.current_price)}
            </span>
          </div>
        )}

        {workflowResult && (
          <div className="workflow-results">
            <div className="result-card">
              <h3>Agent 1 — Pricing</h3>

              <span className="muted">Suggested Price</span>
              <div className="result-price">
                {formatMoney(
                  workflowResult.pricing_result.suggested_price
                )}
              </div>

              <p>
                Method:{" "}
                <strong>
                  {workflowResult.pricing_result.method}
                </strong>
              </p>

              <p>
                Confidence:{" "}
                <strong>
                  {(
                    workflowResult.pricing_result.confidence * 100
                  ).toFixed(0)}
                  %
                </strong>
              </p>
            </div>

            <div className="result-card">
              <h3>Agent 2 — Listing</h3>

              <p>
                Status:{" "}
                <strong
                  className={
                    workflowResult.listing_result.status === "success"
                      ? "status-success"
                      : "status-failed"
                  }
                >
                  {workflowResult.listing_result.status}
                </strong>
              </p>

              <p>
                Listing ID:{" "}
                <strong>
                  {workflowResult.listing_result.listing_id || "N/A"}
                </strong>
              </p>

              {workflowResult.listing_result.error_message && (
                <p className="status-failed">
                  {workflowResult.listing_result.error_message}
                </p>
              )}
            </div>
          </div>
        )}

        <p className="workflow-note">
          everythings fake LOL
        </p>
      </section>
    </main>
  );
}

export default App;
