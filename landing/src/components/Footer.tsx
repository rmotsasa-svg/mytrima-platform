import { Link } from "react-router-dom";

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-top">
        <img src="/brand/lockup-horizontal-light.svg" alt="Mytrima" className="footer-logo" />
        <nav className="footer-nav">
          <Link to="/about">About us</Link>
          <Link to="/solution">Our solution</Link>
          <Link to="/packages">Packages</Link>
          <Link to="/success-stories">Success stories</Link>
          <Link to="/contact">Contact</Link>
        </nav>
      </div>
      <p>Maseru, Lesotho</p>
    </footer>
  );
}
